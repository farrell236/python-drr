from __future__ import annotations

import multiprocessing as mp
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np
from tqdm import tqdm

from .attenuation import validate_projection_model
from .backends.cpu import _ray_integral_siddon_jacobs_image
from .geometry import DRRGeometry, detector_pixel_centers_world, make_orbit_pose
from .backends import ray_integral_siddon_jacobs, resolve_backend
from .volume import Volume, volume_center_world_xyz, world_xyz_to_image_physical_xyz

ProjectorFn = Callable[..., float]

# Globals used by multiprocessing workers.
_MP_VOL: Optional[Volume] = None
_MP_SOURCE_MM: Optional[np.ndarray] = None
_MP_DET_PTS: Optional[np.ndarray] = None
_MP_PROJECTOR_FN: Optional[ProjectorFn] = None
_MP_PROJECTOR_KWARGS: Optional[Dict] = None


def _prepare_backend_volume(vol: Volume, backend: str) -> tuple[str, object | None]:
    resolved = resolve_backend(backend)
    if resolved == "cuda":
        from .backends.cuda import upload_volume_to_gpu

        return resolved, upload_volume_to_gpu(vol)
    if resolved == "mps":
        from .backends.mps import _prepare_volume_torch

        return resolved, _prepare_volume_torch(vol, "mps")
    return resolved, None


def _init_row_worker(vol: Volume, source_mm: np.ndarray, det_pts: np.ndarray, projector_fn: ProjectorFn, projector_kwargs: Dict) -> None:
    global _MP_VOL, _MP_SOURCE_MM, _MP_DET_PTS, _MP_PROJECTOR_FN, _MP_PROJECTOR_KWARGS
    _MP_VOL = vol
    _MP_SOURCE_MM = source_mm
    _MP_DET_PTS = det_pts
    _MP_PROJECTOR_FN = projector_fn
    _MP_PROJECTOR_KWARGS = projector_kwargs


def _render_row(row_idx: int) -> Tuple[int, np.ndarray]:
    if _MP_VOL is None or _MP_SOURCE_MM is None or _MP_DET_PTS is None or _MP_PROJECTOR_FN is None or _MP_PROJECTOR_KWARGS is None:
        raise RuntimeError("Multiprocessing renderer worker is not initialized")

    row_pts = _MP_DET_PTS[row_idx]
    row = np.zeros((row_pts.shape[0],), dtype=np.float32)
    for c, end_xyz in enumerate(row_pts):
        row[c] = _MP_PROJECTOR_FN(
            vol=_MP_VOL,
            start_xyz=_MP_SOURCE_MM,
            end_xyz=end_xyz,
            **_MP_PROJECTOR_KWARGS,
        )
    return row_idx, row


def generate_drr(
    vol: Volume,
    geom: DRRGeometry,
    projector_fn: ProjectorFn = ray_integral_siddon_jacobs,
    projector_kwargs: Optional[Dict] = None,
    show_progress: bool = True,
    n_cores: Optional[int] = None,
    mp_chunksize: int = 1,
    backend: str = "cpu",
    _prepared_volume: object | None = None,
) -> np.ndarray:
    if projector_kwargs is None:
        projector_kwargs = {}

    backend = resolve_backend(backend)

    if backend == "cuda":
        if n_cores not in (None, 1):
            raise ValueError("n_cores is not used when backend='cuda'")
        if mp_chunksize != 1:
            raise ValueError("mp_chunksize is not used when backend='cuda'")

        from .backends.cuda import render_drr_cuda
        return render_drr_cuda(
            vol=vol,
            geom=geom,
            hu_air_threshold=projector_kwargs.get("hu_air_threshold", -900.0),
            clamp_negative_to_zero=projector_kwargs.get("clamp_negative_to_zero", True),
            projection_model=projector_kwargs.get("projection_model", "raw"),
            prepared_volume=_prepared_volume,
        )

    if backend == "mps":
        if n_cores not in (None, 1):
            raise ValueError("n_cores is not used when backend='mps'")
        if mp_chunksize != 1:
            raise ValueError("mp_chunksize is not used when backend='mps'")

        from .backends.mps import render_drr_mps
        return render_drr_mps(
            vol=vol,
            geom=geom,
            hu_air_threshold=projector_kwargs.get("hu_air_threshold", -900.0),
            clamp_negative_to_zero=projector_kwargs.get("clamp_negative_to_zero", True),
            projection_model=projector_kwargs.get("projection_model", "raw"),
            prepared_volume=_prepared_volume,
        )

    if mp_chunksize < 1:
        raise ValueError("mp_chunksize must be >= 1")

    det_pts = detector_pixel_centers_world(geom)
    source_mm = geom.source_mm
    effective_projector = projector_fn
    if projector_fn is ray_integral_siddon_jacobs:
        source_mm = world_xyz_to_image_physical_xyz(vol, source_mm)
        det_pts = world_xyz_to_image_physical_xyz(vol, det_pts)
        projector_kwargs = {
            **projector_kwargs,
            "projection_model": validate_projection_model(
                projector_kwargs.get("projection_model", "raw")
            ),
        }
        effective_projector = _ray_integral_siddon_jacobs_image
    H, W, _ = det_pts.shape
    drr = np.zeros((H, W), dtype=np.float32)

    use_mp = n_cores is not None and int(n_cores) > 1

    if not use_mp:
        row_iter = range(H)
        if show_progress:
            row_iter = tqdm(row_iter, desc="Rendering DRR", leave=False)

        for r in row_iter:
            for c in range(W):
                drr[r, c] = effective_projector(
                    vol=vol,
                    start_xyz=source_mm,
                    end_xyz=det_pts[r, c],
                    **projector_kwargs,
                )
        return drr

    n_cores = int(n_cores)
    with mp.Pool(
        processes=n_cores,
        initializer=_init_row_worker,
        initargs=(vol, source_mm, det_pts, effective_projector, projector_kwargs),
    ) as pool:
        results_iter = pool.imap(_render_row, range(H), chunksize=mp_chunksize)
        if show_progress:
            results_iter = tqdm(results_iter, total=H, desc=f"Rendering DRR ({n_cores} cores)", leave=False)
        for r, row in results_iter:
            drr[r] = row
    return drr


def generate_orbit_drrs(
    vol: Volume,
    angles_deg: List[float],
    sid_mm: float = 1000.0,
    idd_mm: float = 500.0,
    detector_size_px: Tuple[int, int] = (512, 512),
    detector_spacing_mm: Tuple[float, float] = (1.0, 1.0),
    projector_fn: ProjectorFn = ray_integral_siddon_jacobs,
    projector_kwargs: Optional[Dict] = None,
    n_cores: Optional[int] = None,
    mp_chunksize: int = 1,
    show_progress: bool = True,
    backend: str = "cpu",
    orbit_tilt_x_deg: float = 0.0,
    orbit_tilt_y_deg: float = 0.0,
    detector_roll_deg: float = 0.0,
) -> List[np.ndarray]:
    if projector_kwargs is None:
        projector_kwargs = {}

    iso_center = volume_center_world_xyz(vol)
    resolved_backend, prepared_volume = _prepare_backend_volume(vol, backend)
    drrs = []
    angle_iter = tqdm(angles_deg, desc="Orbit DRRs") if show_progress else angles_deg

    for ang in angle_iter:
        geom = make_orbit_pose(
            iso_center_mm=iso_center,
            projection_angle_deg=ang,
            sid_mm=sid_mm,
            idd_mm=idd_mm,
            orbit_tilt_x_deg=orbit_tilt_x_deg,
            orbit_tilt_y_deg=orbit_tilt_y_deg,
            detector_roll_deg=detector_roll_deg,
            detector_size_px=detector_size_px,
            detector_spacing_mm=detector_spacing_mm,
        )
        drr = generate_drr(
            vol=vol,
            geom=geom,
            projector_fn=projector_fn,
            projector_kwargs=projector_kwargs,
            show_progress=False,
            n_cores=n_cores,
            mp_chunksize=mp_chunksize,
            backend=resolved_backend,
            _prepared_volume=prepared_volume,
        )
        drrs.append(drr)

    return drrs
