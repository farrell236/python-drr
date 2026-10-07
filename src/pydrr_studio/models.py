from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class VolumeInfo(BaseModel):
    id: str
    filename: str
    shape_zyx: tuple[int, int, int]
    spacing_zyx_mm: tuple[float, float, float]
    origin_zyx_mm: tuple[float, float, float]
    direction: list[list[float]]
    intensity_min: float
    intensity_max: float
    center_world_xyz_mm: tuple[float, float, float]
    geometry_valid: bool = True
    orientation_warning: str | None = None
    session_id: str | None = None


class VoxelSample(BaseModel):
    voxel_zyx: tuple[int, int, int]
    world_xyz_mm: tuple[float, float, float]
    intensity: float


BackendName = Literal["auto", "cpu", "cuda", "mps"]
ProjectionModelName = Literal["raw", "relative_attenuation"]
MediaExportFormat = Literal["gif", "mp4"]


class BackendInfo(BaseModel):
    id: Literal["cpu", "cuda", "mps"]
    label: str
    available: bool
    detail: str
    package: str | None = None
    version: str | None = None


class PackageInfo(BaseModel):
    name: str
    distribution: str
    installed: bool
    version: str | None = None
    required: bool


class RuntimeInfo(BaseModel):
    python_executable: str
    python_version: str
    architecture: str
    platform: str
    ready: bool
    status: str
    resolved_backend: Literal["cpu", "cuda", "mps"]
    backends: list[BackendInfo]
    packages: list[PackageInfo]


class RenderSettings(BaseModel):
    volume_id: str
    projection_angle_deg: float = Field(0.0, ge=-360.0, le=360.0)
    sid_mm: float = Field(1000.0, gt=0.0, le=5000.0)
    idd_mm: float = Field(500.0, ge=0.0, le=5000.0)
    detector_height_px: int = Field(512, ge=16, le=2048)
    detector_width_px: int = Field(512, ge=16, le=2048)
    detector_row_spacing_mm: float = Field(0.51, gt=0.0, le=20.0)
    detector_col_spacing_mm: float = Field(0.51, gt=0.0, le=20.0)
    translate_x_mm: float = Field(0.0, ge=-1000.0, le=1000.0)
    translate_y_mm: float = Field(0.0, ge=-1000.0, le=1000.0)
    translate_z_mm: float = Field(0.0, ge=-1000.0, le=1000.0)
    orbit_tilt_x_deg: float = Field(0.0, ge=-180.0, le=180.0)
    orbit_tilt_y_deg: float = Field(0.0, ge=-180.0, le=180.0)
    detector_roll_deg: float = Field(0.0, ge=-180.0, le=180.0)
    detector_offset_u_mm: float = Field(0.0, ge=-1000.0, le=1000.0)
    detector_offset_v_mm: float = Field(0.0, ge=-1000.0, le=1000.0)
    hu_air_threshold: float | None = Field(-900.0, ge=-10000.0, le=10000.0)
    clamp_negative_to_zero: bool = True
    projection_model: ProjectionModelName = "raw"
    invert: bool = True
    p_lo: float = Field(1.0, ge=0.0, le=100.0)
    p_hi: float = Field(99.5, ge=0.0, le=100.0)
    backend: BackendName = "auto"
    cpu_workers: int = Field(1, ge=1, le=64)

    @model_validator(mode="after")
    def validate_percentiles(self) -> "RenderSettings":
        if self.p_hi <= self.p_lo:
            raise ValueError("p_hi must be greater than p_lo")
        return self


class BatchSettings(BaseModel):
    render: RenderSettings
    start_angle_deg: float = Field(0.0, ge=-3600.0, le=3600.0)
    end_angle_deg: float = Field(355.0, ge=-3600.0, le=3600.0)
    step_deg: float = Field(5.0, gt=0.0, le=360.0)
    shared_normalization: bool = True
    include_raw: bool = True

    @model_validator(mode="after")
    def validate_sweep(self) -> "BatchSettings":
        if self.end_angle_deg < self.start_angle_deg:
            raise ValueError("end_angle_deg must be greater than or equal to start_angle_deg")
        count = int((self.end_angle_deg - self.start_angle_deg) / self.step_deg) + 1
        if count > 720:
            raise ValueError("A batch is limited to 720 projections")
        return self


class JobCreated(BaseModel):
    id: str
    kind: Literal["render", "batch"]
    status: Literal["queued"] = "queued"


class JobInfo(BaseModel):
    id: str
    kind: Literal["render", "batch"]
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    progress: float
    message: str
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    error: str | None = None
    frame_count: int | None = None
    current_angle_deg: float | None = None
    image_url: str | None = None
    download_url: str | None = None
    metadata: dict | None = None


class MediaExportSettings(BaseModel):
    format: MediaExportFormat
    filename: str | None = Field(None, max_length=120)
    fps: float = Field(12.0, ge=1.0, le=60.0)
    start_frame: int = Field(0, ge=0)
    end_frame: int | None = Field(None, ge=0)
    direction: Literal["forward", "reverse", "ping-pong"] = "forward"
    max_dimension_px: int | None = Field(1024, ge=128, le=2048)
    overlay: Literal["none", "angle", "angle_and_frame"] = "none"
    loop: bool = True
    gif_quality: Literal["standard", "high"] = "standard"
    dither: bool = True
    mp4_quality: Literal["standard", "high", "maximum"] = "high"

    @model_validator(mode="after")
    def validate_frame_range(self) -> "MediaExportSettings":
        if self.end_frame is not None and self.end_frame < self.start_frame:
            raise ValueError("end_frame must be greater than or equal to start_frame")
        return self


class MediaExportCreated(BaseModel):
    id: str
    status: Literal["queued", "running", "completed"] = "queued"


class MediaExportInfo(BaseModel):
    id: str
    job_id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    progress: float
    message: str
    format: MediaExportFormat
    filename: str
    created_at: str
    completed_at: str | None = None
    error: str | None = None
    download_url: str | None = None
    settings: MediaExportSettings


class SessionStateUpdate(BaseModel):
    session_id: str
    state: dict


class SessionSnapshot(BaseModel):
    active: bool
    session_id: str | None = None
    updated_at: str | None = None
    volume: VolumeInfo | None = None
    jobs: list[JobInfo] = Field(default_factory=list)
    state: dict = Field(default_factory=dict)
