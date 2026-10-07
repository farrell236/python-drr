from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import numpy as np

from ..geometry import DRRGeometry, detector_pixel_centers_world
from ..volume import Volume, world_xyz_to_image_physical_xyz
from ..attenuation import validate_projection_model


def _require_mps():
    try:
        import torch
    except Exception as exc:
        raise ImportError(
            "PyTorch is required for backend='mps'. Install the Apple Silicon "
            "Studio requirements in the Python environment that starts PyDRR."
        ) from exc
    mps = getattr(torch.backends, "mps", None)
    if mps is None or not mps.is_available():
        raise RuntimeError(
            "backend='mps' was requested, but this PyTorch runtime cannot access MPS."
        )
    return torch


@dataclass(frozen=True)
class _TorchVolumeState:
    device: str
    data: Any
    shape_zyx: tuple[int, int, int]
    spacing_zyx: tuple[float, float, float]
    box_max: Any
    spacing: Any
    planes: tuple[Any, Any, Any]


def _prepare_volume_torch(vol: Volume, device: str) -> _TorchVolumeState:
    import torch

    tensor_device = torch.device(device)
    nz, ny, nx = (int(value) for value in vol.data.shape)
    sz, sy, sx = (float(value) for value in vol.spacing_zyx)
    return _TorchVolumeState(
        device=str(tensor_device),
        data=torch.as_tensor(vol.data, dtype=torch.float32, device=tensor_device),
        shape_zyx=(nz, ny, nx),
        spacing_zyx=(sz, sy, sx),
        box_max=torch.tensor(
            [nx * sx, ny * sy, nz * sz],
            dtype=torch.float32,
            device=tensor_device,
        ),
        spacing=torch.tensor([sx, sy, sz], dtype=torch.float32, device=tensor_device),
        planes=(
            torch.arange(1, nx, dtype=torch.float32, device=tensor_device) * sx,
            torch.arange(1, ny, dtype=torch.float32, device=tensor_device) * sy,
            torch.arange(1, nz, dtype=torch.float32, device=tensor_device) * sz,
        ),
    )


def _render_drr_torch(
    vol: Volume,
    geom: DRRGeometry,
    *,
    device: str,
    hu_air_threshold: Optional[float] = -900.0,
    clamp_negative_to_zero: bool = True,
    projection_model: str = "raw",
    candidate_budget: int = 1_500_000,
    prepared_volume: _TorchVolumeState | None = None,
) -> np.ndarray:
    """Exact voxel-boundary ray integration using batched tensor operations.

    Every ray is intersected with all axis-aligned voxel planes, then the
    resulting segment midpoints are used to gather the traversed voxel values.
    The math matches the CPU Siddon/Jacobs projector while allowing PyTorch to
    execute the batches on Apple Metal.
    """
    import torch
    projection_model = validate_projection_model(projection_model)

    tensor_device = torch.device(device)
    prepared = prepared_volume or _prepare_volume_torch(vol, device)
    if prepared.device != str(tensor_device):
        raise ValueError("Prepared volume device does not match the render device")
    data = prepared.data
    nz, ny, nx = prepared.shape_zyx
    sz, sy, sx = prepared.spacing_zyx
    box_max = prepared.box_max
    spacing = prepared.spacing

    detector_points = world_xyz_to_image_physical_xyz(
        vol, detector_pixel_centers_world(geom)
    ).astype(np.float32)
    height, width, _ = detector_points.shape
    endpoints = torch.as_tensor(
        detector_points.reshape(-1, 3), dtype=torch.float32, device=tensor_device
    )
    source = torch.as_tensor(
        world_xyz_to_image_physical_xyz(vol, geom.source_mm).astype(np.float32),
        dtype=torch.float32,
        device=tensor_device,
    )

    planes = prepared.planes
    candidate_count = nx + ny + nz - 1
    batch_size = max(64, min(4096, candidate_budget // max(candidate_count, 1)))
    output = torch.zeros((endpoints.shape[0],), dtype=torch.float32, device=tensor_device)
    eps = 1e-6

    for start in range(0, endpoints.shape[0], batch_size):
        stop = min(start + batch_size, endpoints.shape[0])
        ray = endpoints[start:stop] - source
        ray_length = torch.linalg.vector_norm(ray, dim=1)
        direction = ray / torch.clamp(ray_length[:, None], min=eps)
        parallel = torch.abs(direction) < eps
        outside = parallel & ((source < 0.0) | (source > box_max))
        safe_direction = torch.where(parallel, torch.ones_like(direction), direction)
        first = (0.0 - source) / safe_direction
        second = (box_max - source) / safe_direction
        near = torch.minimum(first, second).expand_as(direction)
        far = torch.maximum(first, second).expand_as(direction)
        near = torch.where(parallel, torch.full_like(near, -torch.inf), near)
        far = torch.where(parallel, torch.full_like(far, torch.inf), far)
        enter = torch.clamp(torch.amax(near, dim=1), min=0.0)
        exit = torch.minimum(torch.amin(far, dim=1), ray_length)
        ray_valid = (~torch.any(outside, dim=1)) & (exit > enter)

        candidates = [enter[:, None], exit[:, None]]
        for axis, axis_planes in enumerate(planes):
            if axis_planes.numel() == 0:
                continue
            values = (axis_planes[None, :] - source[axis]) / safe_direction[:, axis, None]
            valid = (
                (~parallel[:, axis, None])
                & ray_valid[:, None]
                & (values > enter[:, None] + eps)
                & (values < exit[:, None] - eps)
            )
            candidates.append(torch.where(valid, values, exit[:, None]))

        ordered = torch.sort(torch.cat(candidates, dim=1), dim=1).values
        segment_length = ordered[:, 1:] - ordered[:, :-1]
        midpoint_t = (ordered[:, 1:] + ordered[:, :-1]) * 0.5
        midpoint = source[None, None, :] + midpoint_t[:, :, None] * direction[:, None, :]
        indices = torch.floor(midpoint / spacing).to(torch.long)
        ix = torch.clamp(indices[:, :, 0], 0, nx - 1)
        iy = torch.clamp(indices[:, :, 1], 0, ny - 1)
        iz = torch.clamp(indices[:, :, 2], 0, nz - 1)
        values = data[iz, iy, ix]
        air_mask = None
        if hu_air_threshold is not None:
            air_mask = values < float(hu_air_threshold)
        if projection_model == "relative_attenuation":
            values = torch.clamp(1.0 + values / 1000.0, min=0.0)
        elif clamp_negative_to_zero:
            values = torch.clamp(values, min=0.0)
        if air_mask is not None:
            values = torch.where(air_mask, 0.0, values)
        segment_valid = ray_valid[:, None] & (segment_length > eps)
        integral = torch.sum(
            torch.where(segment_valid, values * segment_length, 0.0), dim=1
        )
        output[start:stop] = integral

    return output.detach().cpu().numpy().reshape(height, width).astype(np.float32)


def render_drr_mps(
    vol: Volume,
    geom: DRRGeometry,
    hu_air_threshold: Optional[float] = -900.0,
    clamp_negative_to_zero: bool = True,
    projection_model: str = "raw",
    prepared_volume: _TorchVolumeState | None = None,
) -> np.ndarray:
    _require_mps()
    return _render_drr_torch(
        vol,
        geom,
        device="mps",
        hu_air_threshold=hu_air_threshold,
        clamp_negative_to_zero=clamp_negative_to_zero,
        projection_model=projection_model,
        prepared_volume=prepared_volume,
    )
