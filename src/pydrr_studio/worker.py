from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
import zipfile
from pathlib import Path
from typing import Any

import imageio.v2 as imageio
import numpy as np

from pydrr.backends import resolve_backend
from pydrr.geometry import DRRGeometry, make_orbit_frame, make_orbit_pose
from pydrr.renderer import generate_drr
from pydrr.visualization import normalize_image
from pydrr.volume import Volume, load_volume_sitk, volume_center_world_xyz

from .models import BatchSettings, RenderSettings


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def _progress(output_dir: Path, progress: float, message: str, angle: float | None = None) -> None:
    _write_json(output_dir / "progress.json", {
        "progress": progress,
        "message": message,
        "current_angle_deg": angle,
    })


def _build_geometry(volume: Volume, settings: RenderSettings) -> tuple[DRRGeometry, np.ndarray]:
    iso_center = volume_center_world_xyz(volume) + np.array(
        [settings.translate_x_mm, settings.translate_y_mm, settings.translate_z_mm],
        dtype=np.float32,
    )
    geometry = make_orbit_pose(
        iso_center_mm=iso_center,
        projection_angle_deg=settings.projection_angle_deg,
        sid_mm=settings.sid_mm,
        idd_mm=settings.idd_mm,
        orbit_tilt_x_deg=settings.orbit_tilt_x_deg,
        orbit_tilt_y_deg=settings.orbit_tilt_y_deg,
        detector_roll_deg=settings.detector_roll_deg,
        detector_offset_u_mm=settings.detector_offset_u_mm,
        detector_offset_v_mm=settings.detector_offset_v_mm,
        detector_size_px=(settings.detector_height_px, settings.detector_width_px),
        detector_spacing_mm=(settings.detector_row_spacing_mm, settings.detector_col_spacing_mm),
    )
    return geometry, iso_center.astype(np.float32)


def _render_array(volume: Volume, settings: RenderSettings) -> tuple[np.ndarray, DRRGeometry, np.ndarray]:
    geometry, iso_center = _build_geometry(volume, settings)
    backend = resolve_backend(settings.backend)
    workers = settings.cpu_workers if backend == "cpu" and settings.cpu_workers > 1 else None
    drr = generate_drr(
        vol=volume,
        geom=geometry,
        projector_kwargs={
            "hu_air_threshold": settings.hu_air_threshold,
            "clamp_negative_to_zero": settings.clamp_negative_to_zero,
            "projection_model": settings.projection_model,
        },
        show_progress=False,
        n_cores=workers,
        backend=backend,
    )
    return drr, geometry, iso_center


def _volume_info(volume: Volume, volume_id: str, filename: str) -> dict[str, Any]:
    direction = np.asarray(volume.direction, dtype=float)
    warning = None
    if not np.allclose(direction.T @ direction, np.eye(3), atol=1e-5):
        warning = "This volume has a non-orthonormal direction matrix; physical geometry may be invalid."
    return {
        "id": volume_id,
        "filename": filename,
        "shape_zyx": [int(value) for value in volume.shape_zyx],
        "spacing_zyx_mm": [float(value) for value in volume.spacing_zyx],
        "origin_zyx_mm": [float(value) for value in volume.origin_zyx],
        "direction": direction.tolist(),
        "intensity_min": float(volume.data.min()),
        "intensity_max": float(volume.data.max()),
        "center_world_xyz_mm": [float(value) for value in volume_center_world_xyz(volume)],
        "geometry_valid": warning is None,
        "orientation_warning": warning,
    }


def _metadata(
    volume_id: str,
    filename: str,
    settings: RenderSettings,
    geometry: DRRGeometry,
    iso_center: np.ndarray,
    drr: np.ndarray,
) -> dict[str, Any]:
    orbit_frame = make_orbit_frame(settings.orbit_tilt_x_deg, settings.orbit_tilt_y_deg)
    return {
        "geometry_convention": "pydrr-orbit-frame-v2",
        "volume_id": volume_id,
        "volume_filename": filename,
        "settings": settings.model_dump(),
        "compute": {
            "requested_backend": settings.backend,
            "resolved_backend": resolve_backend(settings.backend),
            "python_executable": sys.executable,
        },
        "geometry": {
            "source_mm": geometry.source_mm.tolist(),
            "detector_center_mm": geometry.detector_center_mm.tolist(),
            "detector_u": geometry.detector_u_mm.tolist(),
            "detector_v": geometry.detector_v_mm.tolist(),
            "isocenter_mm": iso_center.tolist(),
            "orbit_frame": {
                "x_world": orbit_frame.x_world.tolist(),
                "y_world": orbit_frame.y_world.tolist(),
                "normal_world": orbit_frame.normal_world.tolist(),
            },
        },
        "projection": {
            "shape": list(drr.shape),
            "dtype": str(drr.dtype),
            "min": float(drr.min()),
            "max": float(drr.max()),
            "mean": float(drr.mean()),
        },
    }


def _run_render(spec: dict[str, Any], output_dir: Path, volume: Volume) -> dict[str, Any]:
    settings = RenderSettings.model_validate(spec["render"])
    _progress(output_dir, 0.05, f"Tracing projection rays on {resolve_backend(settings.backend).upper()}", settings.projection_angle_deg)
    drr, geometry, iso_center = _render_array(volume, settings)
    png_path = output_dir / "projection.png"
    raw_path = output_dir / "projection.npy"
    normalized = normalize_image(drr, invert=settings.invert, p_lo=settings.p_lo, p_hi=settings.p_hi)
    imageio.imwrite(png_path, (normalized * 255).astype(np.uint8))
    np.save(raw_path, drr.astype(np.float32))
    metadata = _metadata(spec["volume_id"], spec["volume_filename"], settings, geometry, iso_center, drr)
    manifest_path = output_dir / "manifest.json"
    _write_json(manifest_path, metadata)
    archive_path = output_dir / "pydrr-projection.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(png_path, png_path.name)
        archive.write(raw_path, raw_path.name)
        archive.write(manifest_path, manifest_path.name)
    _progress(output_dir, 1.0, "Projection ready", settings.projection_angle_deg)
    return {
        "message": "Projection ready",
        "image_path": str(png_path),
        "archive_path": str(archive_path),
        "metadata": metadata,
        "current_angle_deg": settings.projection_angle_deg,
    }


def _run_batch(spec: dict[str, Any], output_dir: Path, volume: Volume) -> dict[str, Any]:
    settings = BatchSettings.model_validate(spec["batch"])
    frames_dir = output_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    angles = np.arange(
        settings.start_angle_deg,
        settings.end_angle_deg + settings.step_deg * 0.5,
        settings.step_deg,
        dtype=float,
    ).tolist()
    raw_paths: list[Path] = []
    percentile_samples: list[np.ndarray] = []
    geometries: list[tuple[RenderSettings, DRRGeometry, np.ndarray]] = []
    for index, angle in enumerate(angles):
        _progress(output_dir, index / len(angles), f"Rendering frame {index + 1} of {len(angles)}", angle)
        frame_settings = settings.render.model_copy(update={"projection_angle_deg": angle})
        drr, geometry, iso_center = _render_array(volume, frame_settings)
        stem = f"frame_{index:04d}_angle_{angle:+08.3f}"
        raw_path = frames_dir / f"{stem}.npy"
        np.save(raw_path, drr.astype(np.float32))
        raw_paths.append(raw_path)
        if settings.shared_normalization:
            stride = max(1, drr.size // 4096)
            percentile_samples.append(drr.reshape(-1)[::stride])
        geometries.append((frame_settings, geometry, iso_center))

    if settings.shared_normalization:
        sample = np.concatenate(percentile_samples)
        shared_lo = float(np.percentile(sample, settings.render.p_lo))
        shared_hi = float(np.percentile(sample, settings.render.p_hi))
    else:
        shared_lo = shared_hi = None

    _progress(output_dir, 0.92, "Normalizing and packaging projections", angles[-1])
    frames_metadata: list[dict[str, Any]] = []
    first_image: Path | None = None
    for index, (angle, raw_path, geometry_info) in enumerate(zip(angles, raw_paths, geometries)):
        drr = np.load(raw_path, mmap_mode="r")
        frame_settings, geometry, iso_center = geometry_info
        if shared_lo is None or shared_hi is None or shared_hi <= shared_lo:
            normalized = normalize_image(drr, invert=frame_settings.invert, p_lo=frame_settings.p_lo, p_hi=frame_settings.p_hi)
        else:
            normalized = np.clip((drr - shared_lo) / (shared_hi - shared_lo), 0.0, 1.0)
            if frame_settings.invert:
                normalized = 1.0 - normalized
        stem = f"frame_{index:04d}_angle_{angle:+08.3f}"
        png_path = frames_dir / f"{stem}.png"
        imageio.imwrite(png_path, (normalized * 255).astype(np.uint8))
        frames_metadata.append(_metadata(spec["volume_id"], spec["volume_filename"], frame_settings, geometry, iso_center, drr))
        first_image = first_image or png_path
        if not settings.include_raw:
            del drr
            raw_path.unlink(missing_ok=True)

    manifest = {
        "kind": "angle_sweep",
        "geometry_convention": "pydrr-orbit-frame-v2",
        "volume": _volume_info(volume, spec["volume_id"], spec["volume_filename"]),
        "angles_deg": angles,
        "shared_normalization": settings.shared_normalization,
        "shared_window": {"low": shared_lo, "high": shared_hi} if shared_lo is not None else None,
        "frames": frames_metadata,
    }
    manifest_path = output_dir / "manifest.json"
    _write_json(manifest_path, manifest)
    archive_path = output_dir / "pydrr-angle-sweep.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(manifest_path, manifest_path.name)
        for file_path in sorted(frames_dir.iterdir()):
            archive.write(file_path, f"frames/{file_path.name}")
    _progress(output_dir, 1.0, f"Completed {len(angles)} projections", angles[-1])
    return {
        "message": f"Completed {len(angles)} projections",
        "image_path": str(first_image) if first_image else None,
        "archive_path": str(archive_path),
        "metadata": {"angles_deg": angles, "shared_normalization": settings.shared_normalization},
        "current_angle_deg": angles[-1],
    }


def execute(job_path: Path) -> int:
    spec = json.loads(job_path.read_text(encoding="utf-8"))
    output_dir = Path(spec["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    result_path = output_dir / "result.json"
    try:
        volume = load_volume_sitk(spec["volume_path"])
        if spec["kind"] == "render":
            result = _run_render(spec, output_dir, volume)
        elif spec["kind"] == "batch":
            result = _run_batch(spec, output_dir, volume)
        else:
            raise ValueError(f"Unknown worker job kind: {spec['kind']}")
        _write_json(result_path, {"ok": True, **result})
        return 0
    except Exception as exc:
        traceback.print_exc()
        _write_json(result_path, {"ok": False, "error": f"{type(exc).__name__}: {exc}"})
        return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Internal PyDRR Studio rendering worker")
    parser.add_argument("--job", required=True, type=Path)
    args = parser.parse_args(argv)
    return execute(args.job)


if __name__ == "__main__":
    raise SystemExit(main())
