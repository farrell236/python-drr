from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .models import (
    BatchSettings,
    JobCreated,
    JobInfo,
    MediaExportCreated,
    MediaExportInfo,
    MediaExportSettings,
    RenderSettings,
    RuntimeInfo,
    SessionSnapshot,
    SessionStateUpdate,
    VolumeInfo,
    VoxelSample,
)
from .runtime import runtime_manager
from .service import StudioService


service = StudioService(runtime_manager)

@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    service.close()
    runtime_manager.close()


app = FastAPI(title="PyDRR Studio", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def protect_loopback_api(request: Request, call_next):
    """Only accept browser-originated requests from a loopback-hosted Studio."""
    origin = request.headers.get("origin")
    hostname = urlsplit(origin).hostname if origin else None
    if origin and hostname not in {"localhost", "127.0.0.1", "::1"}:
        return JSONResponse(status_code=403, content={"detail": "Origin is not allowed"})
    return await call_next(request)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "PyDRR Studio"}


@app.get("/api/runtime", response_model=RuntimeInfo)
def runtime() -> RuntimeInfo:
    try:
        return runtime_manager.info()
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/session", response_model=SessionSnapshot)
def session() -> SessionSnapshot:
    return service.session_snapshot()


@app.put("/api/session", response_model=SessionSnapshot)
def update_session(update: SessionStateUpdate) -> SessionSnapshot:
    try:
        return service.update_session_state(update.session_id, update.state)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc


@app.delete("/api/session/{session_id}", status_code=204)
def discard_session(session_id: str) -> Response:
    try:
        service.discard_session(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc
    return Response(status_code=204)


@app.post("/api/volumes", response_model=VolumeInfo)
def upload_volume(file: UploadFile = File(...)) -> VolumeInfo:
    filename = file.filename or "volume.nii.gz"
    lower = filename.lower()
    if not (lower.endswith(".nii") or lower.endswith(".nii.gz")):
        raise HTTPException(status_code=400, detail="Upload a .nii or .nii.gz volume")
    try:
        return service.save_volume(file.file, filename)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read the volume: {exc}") from exc


@app.get("/api/volumes/{volume_id}/slices/{axis}")
def volume_slice(
    volume_id: str,
    axis: str,
    index: int | None = None,
    window_center: float | None = None,
    window_width: float | None = Query(None, gt=0.0),
) -> Response:
    try:
        content = service.slice_png(
            volume_id,
            axis,
            index,
            window_center=window_center,
            window_width=window_width,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Volume not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@app.get("/api/volumes/{volume_id}/render-data")
def volume_render_data(
    volume_id: str,
    max_dimension: int = Query(256, ge=32, le=384),
) -> Response:
    try:
        content, dimensions_xyz, spacing_xyz = service.volume_render_data(
            volume_id,
            max_dimension=max_dimension,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Volume not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={
            "X-PyDRR-Dimensions": ",".join(str(value) for value in dimensions_xyz),
            "X-PyDRR-Spacing": ",".join(f"{value:.9g}" for value in spacing_xyz),
            "Cache-Control": "private, max-age=3600",
        },
    )


@app.get("/api/volumes/{volume_id}/sample", response_model=VoxelSample)
def volume_sample(
    volume_id: str,
    z: float = Query(...),
    y: float = Query(...),
    x: float = Query(...),
) -> VoxelSample:
    try:
        return service.voxel_sample(volume_id, (z, y, x))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Volume not found") from exc


@app.post("/api/renders", response_model=JobCreated, status_code=202)
def create_render(settings: RenderSettings) -> JobCreated:
    try:
        job = service.create_render(settings)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Volume not found") from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return JobCreated(id=job.id, kind="render")


@app.get("/api/exports/acquisition.sh")
def export_acquisition_script(config: str = Query(...)) -> Response:
    try:
        settings = RenderSettings.model_validate_json(config)
        filename, script = service.acquisition_script(settings)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Volume not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid acquisition settings: {exc}") from exc
    return Response(
        content=script,
        media_type="text/x-shellscript",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@app.post("/api/batches", response_model=JobCreated, status_code=202)
def create_batch(settings: BatchSettings) -> JobCreated:
    try:
        job = service.create_batch(settings)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Volume not found") from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return JobCreated(id=job.id, kind="batch")


@app.get("/api/jobs/{job_id}", response_model=JobInfo)
def get_job(job_id: str) -> JobInfo:
    try:
        return service.job_info(service.get_job(job_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@app.post("/api/jobs/{job_id}/cancel", response_model=JobInfo)
def cancel_job(job_id: str) -> JobInfo:
    try:
        return service.job_info(service.cancel_job(job_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@app.get("/api/jobs/{job_id}/image")
def job_image(job_id: str) -> FileResponse:
    try:
        job = service.get_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    if job.image_path is None or not job.image_path.exists():
        raise HTTPException(status_code=404, detail="No preview image is available")
    return FileResponse(job.image_path, media_type="image/png", filename=job.image_path.name)


@app.get("/api/jobs/{job_id}/frames/{frame_index}")
def batch_frame(job_id: str, frame_index: int) -> FileResponse:
    try:
        frame_path = service.batch_frame_path(job_id, frame_index)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    except (IndexError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(frame_path, media_type="image/png", filename=frame_path.name)


@app.get("/api/jobs/{job_id}/manifest")
def batch_manifest(job_id: str) -> FileResponse:
    try:
        path = service.batch_manifest_path(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="No manifest is available") from exc
    return FileResponse(path, media_type="application/json", filename="manifest.json")


@app.get("/api/jobs/{job_id}/script")
def batch_script(job_id: str) -> Response:
    try:
        filename, script = service.batch_acquisition_script(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=script,
        media_type="text/x-shellscript",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@app.get("/api/jobs/{job_id}/media-exports", response_model=list[MediaExportInfo])
def list_media_exports(job_id: str) -> list[MediaExportInfo]:
    try:
        return [service.media_export_info(item) for item in service.list_media_exports(job_id)]
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@app.post(
    "/api/jobs/{job_id}/media-exports",
    response_model=MediaExportCreated,
    status_code=202,
)
def create_media_export(job_id: str, settings: MediaExportSettings) -> MediaExportCreated:
    try:
        media_export = service.create_media_export(job_id, settings)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return MediaExportCreated(id=media_export.id, status=media_export.status)


@app.get("/api/media-exports/{export_id}", response_model=MediaExportInfo)
def get_media_export(export_id: str) -> MediaExportInfo:
    try:
        return service.media_export_info(service.get_media_export(export_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Media export not found") from exc


@app.post("/api/media-exports/{export_id}/cancel", response_model=MediaExportInfo)
def cancel_media_export(export_id: str) -> MediaExportInfo:
    try:
        return service.media_export_info(service.cancel_media_export(export_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Media export not found") from exc


@app.get("/api/media-exports/{export_id}/download")
def download_media_export(export_id: str) -> FileResponse:
    try:
        media_export = service.get_media_export(export_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Media export not found") from exc
    if (
        media_export.status != "completed"
        or media_export.output_path is None
        or not media_export.output_path.is_file()
    ):
        raise HTTPException(status_code=404, detail="Media export is not available")
    media_type = "image/gif" if media_export.settings.format == "gif" else "video/mp4"
    return FileResponse(
        media_export.output_path,
        media_type=media_type,
        filename=media_export.filename,
    )


@app.get("/api/jobs/{job_id}/download")
def job_download(job_id: str) -> FileResponse:
    try:
        job = service.get_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    if job.archive_path is None or not job.archive_path.exists():
        raise HTTPException(status_code=404, detail="No download is available")
    return FileResponse(job.archive_path, media_type="application/zip", filename=job.archive_path.name)


packaged_frontend = Path(__file__).resolve().parent / "static"
source_frontend = Path(__file__).resolve().parents[2] / "apps" / "studio" / "frontend" / "dist"
frontend_dist = packaged_frontend if (packaged_frontend / "index.html").is_file() else source_frontend
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="studio")
