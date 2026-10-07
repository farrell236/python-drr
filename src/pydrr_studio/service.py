from __future__ import annotations

import json
import math
import shlex
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO

import imageio.v2 as imageio
import numpy as np

from pydrr.geometry import DRRGeometry, make_orbit_pose
from pydrr.visualization import normalize_image
from pydrr.volume import Volume, load_volume_sitk, volume_center_world_xyz, voxel_zyx_to_world_xyz

from .models import BatchSettings, JobInfo, RenderSettings, VolumeInfo, VoxelSample
from .runtime import RuntimeManager, runtime_manager


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_filename(name: str) -> str:
    cleaned = "".join(ch for ch in Path(name).name if ch.isalnum() or ch in {".", "-", "_"})
    return cleaned or "volume.nii.gz"


def normalize_slice(
    image: np.ndarray,
    *,
    window_center: float | None = None,
    window_width: float | None = None,
) -> np.ndarray:
    """Normalize one volume slice for diagnostic display."""
    if window_center is None or window_width is None:
        return normalize_image(image, invert=False, p_lo=1.0, p_hi=99.0)
    if window_width <= 0.0:
        raise ValueError("window_width must be greater than zero")
    low = float(window_center) - float(window_width) / 2.0
    high = float(window_center) + float(window_width) / 2.0
    return np.clip((image.astype(np.float32) - low) / (high - low), 0.0, 1.0)


def downsample_volume_for_rendering(
    data: np.ndarray,
    spacing_zyx_mm: np.ndarray,
    *,
    max_dimension: int = 256,
) -> tuple[np.ndarray, np.ndarray]:
    """Create a bounded display copy while preserving the physical extent."""
    if data.ndim != 3:
        raise ValueError("Volume rendering requires a three-dimensional image")
    if max_dimension < 32:
        raise ValueError("max_dimension must be at least 32")

    shape = np.asarray(data.shape, dtype=int)
    scale = min(1.0, float(max_dimension) / float(shape.max()))
    target_shape = np.array(
        [size if size <= 1 else max(2, min(size, int(round(size * scale)))) for size in shape],
        dtype=int,
    )
    indices = [
        np.rint(np.linspace(0, size - 1, target, dtype=np.float64)).astype(np.intp)
        for size, target in zip(shape, target_shape, strict=True)
    ]
    sampled = np.asarray(data[np.ix_(*indices)], dtype="<f4", order="C")
    if not np.isfinite(sampled).all():
        finite = sampled[np.isfinite(sampled)]
        replacement = float(np.median(finite)) if finite.size else 0.0
        sampled = np.nan_to_num(sampled, nan=replacement, posinf=replacement, neginf=replacement)

    spacing = np.asarray(spacing_zyx_mm, dtype=np.float64)
    rendered_spacing = spacing.copy()
    for axis, (source_size, target_size) in enumerate(zip(shape, target_shape, strict=True)):
        if source_size > 1 and target_size > 1:
            rendered_spacing[axis] *= (source_size - 1) / (target_size - 1)
    return sampled, rendered_spacing.astype(np.float32)


def build_geometry(vol: Volume, settings: RenderSettings) -> tuple[DRRGeometry, np.ndarray]:
    iso_center = volume_center_world_xyz(vol) + np.array(
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


def volume_geometry_status(volume: Volume) -> tuple[bool, str | None]:
    spacing = np.asarray(volume.spacing_zyx, dtype=float)
    direction = np.asarray(volume.direction, dtype=float)
    if spacing.shape != (3,) or not np.isfinite(spacing).all() or np.any(spacing <= 0.0):
        return False, "Acquisition is disabled because the volume spacing is invalid."
    if direction.shape != (3, 3) or not np.isfinite(direction).all():
        return False, "Acquisition is disabled because the direction matrix is invalid."
    determinant = float(np.linalg.det(direction))
    if abs(determinant) < 1e-8:
        return False, "Acquisition is disabled because the direction matrix is singular."
    if not np.allclose(direction.T @ direction, np.eye(3), atol=1e-5):
        return False, (
            "Acquisition is disabled because the direction matrix is not orthonormal. "
            "The volume can still be inspected in the Viewer."
        )
    return True, None


def validate_viewable_volume_geometry(volume: Volume) -> None:
    """Reject geometry that cannot support stable world/voxel navigation."""
    spacing = np.asarray(volume.spacing_zyx, dtype=float)
    direction = np.asarray(volume.direction, dtype=float)
    if spacing.shape != (3,) or not np.isfinite(spacing).all() or np.any(spacing <= 0.0):
        raise ValueError("Volume spacing must contain three finite positive values")
    if direction.shape != (3, 3) or not np.isfinite(direction).all():
        raise ValueError("Volume direction must be a finite 3 by 3 matrix")
    if abs(float(np.linalg.det(direction))) < 1e-8:
        raise ValueError("Volume direction matrix is singular")


@dataclass
class VolumeRecord:
    id: str
    filename: str
    path: Path
    volume: Volume


@dataclass
class JobRecord:
    id: str
    kind: str
    status: str = "queued"
    progress: float = 0.0
    message: str = "Queued"
    created_at: str = field(default_factory=_now)
    started_at: str | None = None
    completed_at: str | None = None
    error: str | None = None
    frame_count: int | None = None
    current_angle_deg: float | None = None
    image_path: Path | None = None
    archive_path: Path | None = None
    metadata: dict | None = None
    cancel_requested: bool = False
    process: subprocess.Popen | None = field(default=None, repr=False)


class StudioService:
    def __init__(self, runtimes: RuntimeManager | None = None) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="pydrr-studio-"))
        self.runtimes = runtimes or runtime_manager
        self.volumes: dict[str, VolumeRecord] = {}
        self.jobs: dict[str, JobRecord] = {}
        self.lock = threading.RLock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pydrr-studio")

    def close(self) -> None:
        with self.lock:
            processes = [job.process for job in self.jobs.values() if job.process is not None]
        for process in processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
        self.executor.shutdown(wait=False, cancel_futures=True)
        shutil.rmtree(self.root, ignore_errors=True)

    def save_volume(self, source: BinaryIO, filename: str) -> VolumeInfo:
        volume_id = uuid.uuid4().hex
        safe_name = _safe_filename(filename)
        volume_dir = self.root / "volumes" / volume_id
        volume_dir.mkdir(parents=True)
        path = volume_dir / safe_name
        with path.open("wb") as destination:
            shutil.copyfileobj(source, destination, length=1024 * 1024)
        try:
            volume = load_volume_sitk(str(path))
            validate_viewable_volume_geometry(volume)
        except Exception:
            shutil.rmtree(volume_dir, ignore_errors=True)
            raise
        record = VolumeRecord(id=volume_id, filename=safe_name, path=path, volume=volume)
        with self.lock:
            self.volumes[volume_id] = record
        return self.volume_info(record)

    def volume_info(self, record: VolumeRecord) -> VolumeInfo:
        direction = np.asarray(record.volume.direction, dtype=float)
        geometry_valid, orientation_warning = volume_geometry_status(record.volume)
        center = volume_center_world_xyz(record.volume)
        return VolumeInfo(
            id=record.id,
            filename=record.filename,
            shape_zyx=tuple(int(value) for value in record.volume.shape_zyx),
            spacing_zyx_mm=tuple(float(value) for value in record.volume.spacing_zyx),
            origin_zyx_mm=tuple(float(value) for value in record.volume.origin_zyx),
            direction=direction.tolist(),
            intensity_min=float(record.volume.data.min()),
            intensity_max=float(record.volume.data.max()),
            center_world_xyz_mm=tuple(float(value) for value in center),
            geometry_valid=geometry_valid,
            orientation_warning=orientation_warning,
        )

    def get_volume(self, volume_id: str) -> VolumeRecord:
        with self.lock:
            record = self.volumes.get(volume_id)
        if record is None:
            raise KeyError(volume_id)
        return record

    def voxel_sample(self, volume_id: str, voxel_zyx: tuple[float, float, float]) -> VoxelSample:
        volume = self.get_volume(volume_id).volume
        rounded = np.rint(np.asarray(voxel_zyx, dtype=float)).astype(int)
        shape = np.asarray(volume.shape_zyx, dtype=int)
        rounded = np.clip(rounded, 0, shape - 1)
        world = voxel_zyx_to_world_xyz(
            rounded.astype(np.float32)[None],
            volume.spacing_zyx,
            volume.origin_zyx,
            volume.direction,
        )[0]
        return VoxelSample(
            voxel_zyx=tuple(int(value) for value in rounded),
            world_xyz_mm=tuple(float(value) for value in world),
            intensity=float(volume.data[tuple(rounded)]),
        )

    def _require_acquisition_geometry(self, volume_id: str) -> VolumeRecord:
        record = self.get_volume(volume_id)
        geometry_valid, warning = volume_geometry_status(record.volume)
        if not geometry_valid:
            raise ValueError(warning or "Volume geometry is invalid for acquisition")
        return record

    def acquisition_script(self, settings: RenderSettings) -> tuple[str, str]:
        record = self.get_volume(settings.volume_id)
        lower_name = record.filename.lower()
        if lower_name.endswith(".nii.gz"):
            stem = record.filename[:-7]
        elif lower_name.endswith(".nii"):
            stem = record.filename[:-4]
        else:
            stem = Path(record.filename).stem
        stem = _safe_filename(stem) or "volume"
        angle_tag = f"{settings.projection_angle_deg:g}".replace("-", "m").replace(".", "p")
        output_filename = f"{stem}_angle_{angle_tag}.png"
        script_filename = f"{stem}_acquisition.sh"
        python_bin = self.runtimes.python_executable
        volume_filename = shlex.quote(record.filename)
        threshold = -900.0 if settings.hu_air_threshold is None else settings.hu_air_threshold

        command = [
            '"$PYTHON_BIN" -m pydrr "$INPUT_VOLUME"',
            f"  -res {settings.detector_row_spacing_mm:g} {settings.detector_col_spacing_mm:g}",
            f"  -size {settings.detector_height_px} {settings.detector_width_px}",
            f"  -scd {settings.sid_mm:g}",
            f"  --idd {settings.idd_mm:g}",
            f"  --isocenter-offset-mm {settings.translate_x_mm:g} {settings.translate_y_mm:g} {settings.translate_z_mm:g}",
            f"  --orbit-tilt-x={settings.orbit_tilt_x_deg:g}",
            f"  --orbit-tilt-y={settings.orbit_tilt_y_deg:g}",
            f"  --detector-roll={settings.detector_roll_deg:g}",
            f"  --projection-angle={settings.projection_angle_deg:g}",
            f"  --detector-offset-mm {settings.detector_offset_u_mm:g} {settings.detector_offset_v_mm:g}",
            f"  --threshold={threshold:g}",
            f"  --projection-model {settings.projection_model.replace('_', '-')}",
            f"  --p-lo {settings.p_lo:g}",
            f"  --p-hi {settings.p_hi:g}",
            f"  --backend {settings.backend}",
        ]
        if settings.backend == "cpu":
            command.append(f"  --n-cores {settings.cpu_workers}")
        if settings.invert:
            command.append("  --invert")
        if not settings.clamp_negative_to_zero:
            command.append("  --no-clamp-negative")
        command.append('  --output "$OUTPUT_IMAGE"')
        command_text = " \\\n".join(command)

        script = f'''#!/usr/bin/env bash
set -euo pipefail

# Generated by PyDRR Studio.
# Usage: bash "{script_filename}" [input-volume] [output-png]

SCRIPT_DIR="$(cd -- "$(dirname -- "${{BASH_SOURCE[0]}}")" && pwd)"
PYTHON_BIN="${{PYTHON_BIN:-{python_bin}}}"
DEFAULT_INPUT="$SCRIPT_DIR"/{volume_filename}
INPUT_VOLUME="${{1:-$DEFAULT_INPUT}}"
OUTPUT_IMAGE="${{2:-$SCRIPT_DIR/{output_filename}}}"

{command_text}
'''
        return script_filename, script

    def slice_png(
        self,
        volume_id: str,
        axis: str,
        index: int | None,
        *,
        window_center: float | None = None,
        window_width: float | None = None,
    ) -> bytes:
        volume = self.get_volume(volume_id).volume
        axis_index = {"axial": 0, "coronal": 1, "sagittal": 2}.get(axis)
        if axis_index is None:
            raise ValueError("axis must be axial, coronal, or sagittal")
        size = volume.data.shape[axis_index]
        selected = size // 2 if index is None else min(max(index, 0), size - 1)
        if axis_index == 0:
            image = volume.data[selected, :, :]
        elif axis_index == 1:
            image = volume.data[:, selected, :]
        else:
            image = volume.data[:, :, selected]
        normalized = normalize_slice(
            image,
            window_center=window_center,
            window_width=window_width,
        )
        output = imageio.imwrite("<bytes>", np.flipud(normalized * 255).astype(np.uint8), format="png")
        return output

    def volume_render_data(
        self,
        volume_id: str,
        *,
        max_dimension: int = 256,
    ) -> tuple[bytes, tuple[int, int, int], tuple[float, float, float]]:
        """Return a little-endian float32 display volume and its XYZ geometry."""
        volume = self.get_volume(volume_id).volume
        sampled, spacing_zyx = downsample_volume_for_rendering(
            volume.data,
            volume.spacing_zyx,
            max_dimension=max_dimension,
        )
        dimensions_xyz = tuple(int(value) for value in sampled.shape[::-1])
        spacing_xyz = tuple(float(value) for value in spacing_zyx[::-1])
        return sampled.tobytes(order="C"), dimensions_xyz, spacing_xyz

    def create_render(self, settings: RenderSettings) -> JobRecord:
        self._require_acquisition_geometry(settings.volume_id)
        python_executable, _ = self.runtimes.ensure_backend(settings.backend)
        job = JobRecord(id=uuid.uuid4().hex, kind="render")
        with self.lock:
            self.jobs[job.id] = job
        self.executor.submit(self._run_render, job.id, settings, python_executable)
        return job

    def create_batch(self, settings: BatchSettings) -> JobRecord:
        self._require_acquisition_geometry(settings.render.volume_id)
        python_executable, _ = self.runtimes.ensure_backend(settings.render.backend)
        count = int(math.floor((settings.end_angle_deg - settings.start_angle_deg) / settings.step_deg)) + 1
        job = JobRecord(id=uuid.uuid4().hex, kind="batch", frame_count=count)
        with self.lock:
            self.jobs[job.id] = job
        self.executor.submit(self._run_batch, job.id, settings, python_executable)
        return job

    def get_job(self, job_id: str) -> JobRecord:
        with self.lock:
            job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def cancel_job(self, job_id: str) -> JobRecord:
        job = self.get_job(job_id)
        with self.lock:
            if job.status in {"queued", "running"}:
                job.cancel_requested = True
                job.message = "Cancellation requested"
                if job.process is not None and job.process.poll() is None:
                    job.process.terminate()
        return job

    def job_info(self, job: JobRecord) -> JobInfo:
        return JobInfo(
            id=job.id,
            kind=job.kind,
            status=job.status,
            progress=job.progress,
            message=job.message,
            created_at=job.created_at,
            started_at=job.started_at,
            completed_at=job.completed_at,
            error=job.error,
            frame_count=job.frame_count,
            current_angle_deg=job.current_angle_deg,
            image_url=f"/api/jobs/{job.id}/image" if job.image_path else None,
            download_url=f"/api/jobs/{job.id}/download" if job.archive_path else None,
            metadata=job.metadata,
        )

    def _set_running(self, job: JobRecord, message: str) -> None:
        with self.lock:
            job.status = "running"
            job.started_at = _now()
            job.message = message

    def _set_failed(self, job: JobRecord, exc: Exception) -> None:
        with self.lock:
            job.status = "failed"
            job.error = f"{type(exc).__name__}: {exc}"
            job.message = "Rendering failed"
            job.completed_at = _now()

    def _run_render(
        self,
        job_id: str,
        settings: RenderSettings,
        python_executable: Path,
    ) -> None:
        record = self.get_volume(settings.volume_id)
        self._run_worker(
            job_id,
            python_executable,
            {
                "kind": "render",
                "volume_id": record.id,
                "volume_filename": record.filename,
                "volume_path": str(record.path.resolve()),
                "render": settings.model_dump(mode="json"),
            },
        )

    def _run_batch(
        self,
        job_id: str,
        settings: BatchSettings,
        python_executable: Path,
    ) -> None:
        record = self.get_volume(settings.render.volume_id)
        self._run_worker(
            job_id,
            python_executable,
            {
                "kind": "batch",
                "volume_id": record.id,
                "volume_filename": record.filename,
                "volume_path": str(record.path.resolve()),
                "batch": settings.model_dump(mode="json"),
            },
        )

    def _run_worker(
        self,
        job_id: str,
        python_executable: Path,
        payload: dict,
    ) -> None:
        job = self.get_job(job_id)
        output_dir = self.root / "jobs" / job.id
        output_dir.mkdir(parents=True, exist_ok=True)
        payload["output_dir"] = str(output_dir)
        job_path = output_dir / "job.json"
        log_path = output_dir / "worker.log"
        result_path = output_dir / "result.json"
        progress_path = output_dir / "progress.json"
        job_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        initial_message = "Preparing angle sweep" if job.kind == "batch" else "Starting projection worker"
        self._set_running(job, initial_message)
        process = None
        log_stream = None
        try:
            if job.cancel_requested:
                with self.lock:
                    job.status = "cancelled"
                    job.message = "Cancelled"
                    job.completed_at = _now()
                return
            process, log_stream = self.runtimes.launch_worker(
                python_executable,
                job_path,
                log_path,
            )
            with self.lock:
                job.process = process

            progress_mtime = 0
            while process.poll() is None:
                if job.cancel_requested:
                    process.terminate()
                try:
                    mtime = progress_path.stat().st_mtime_ns
                    if mtime != progress_mtime:
                        update = json.loads(progress_path.read_text(encoding="utf-8"))
                        progress_mtime = mtime
                        with self.lock:
                            job.progress = float(update.get("progress", job.progress))
                            job.message = str(update.get("message", job.message))
                            angle = update.get("current_angle_deg")
                            if angle is not None:
                                job.current_angle_deg = float(angle)
                except (FileNotFoundError, json.JSONDecodeError, OSError, ValueError):
                    pass
                time.sleep(0.1)

            return_code = process.wait()
            if log_stream is not None:
                log_stream.close()
                log_stream = None
            with self.lock:
                job.process = None
            if job.cancel_requested:
                with self.lock:
                    job.status = "cancelled"
                    job.message = "Cancelled"
                    job.completed_at = _now()
                return

            result = (
                json.loads(result_path.read_text(encoding="utf-8"))
                if result_path.is_file()
                else {}
            )
            if return_code != 0 or not result.get("ok"):
                detail = str(result.get("error") or "")
                if not detail and log_path.is_file():
                    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
                    detail = "\n".join(lines[-20:])
                raise RuntimeError(detail or f"Rendering worker exited with status {return_code}")

            image_value = result.get("image_path")
            archive_value = result.get("archive_path")
            with self.lock:
                job.status = "completed"
                job.progress = 1.0
                job.message = str(result.get("message") or "Completed")
                job.completed_at = _now()
                job.image_path = Path(image_value) if image_value else None
                job.archive_path = Path(archive_value) if archive_value else None
                job.metadata = result.get("metadata")
                angle = result.get("current_angle_deg")
                if angle is not None:
                    job.current_angle_deg = float(angle)
        except Exception as exc:
            if not job.cancel_requested:
                self._set_failed(job, exc)
        finally:
            if process is not None and process.poll() is None:
                process.terminate()
            if log_stream is not None:
                log_stream.close()
            with self.lock:
                job.process = None
