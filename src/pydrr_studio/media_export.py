from __future__ import annotations

from collections.abc import Callable, Sequence
from pathlib import Path

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw

from .models import MediaExportSettings


class ExportCancelled(RuntimeError):
    pass


def export_frame_indices(frame_count: int, settings: MediaExportSettings) -> list[int]:
    end = frame_count - 1 if settings.end_frame is None else settings.end_frame
    if settings.start_frame >= frame_count or end >= frame_count:
        raise ValueError(f"Frame range must be between 1 and {frame_count}")
    indices = list(range(settings.start_frame, end + 1))
    if settings.direction == "reverse":
        indices.reverse()
    elif settings.direction == "ping-pong" and len(indices) > 1:
        indices.extend(indices[-2:0:-1])
    return indices


def _prepare_frame(
    path: Path,
    *,
    angle: float,
    frame_number: int,
    frame_count: int,
    settings: MediaExportSettings,
    even_dimensions: bool,
) -> Image.Image:
    with Image.open(path) as source:
        image = source.convert("RGB")
    if settings.max_dimension_px and max(image.size) > settings.max_dimension_px:
        image.thumbnail((settings.max_dimension_px, settings.max_dimension_px), Image.Resampling.LANCZOS)
    if even_dimensions and (image.width % 2 or image.height % 2):
        padded = Image.new("RGB", (image.width + image.width % 2, image.height + image.height % 2), "black")
        padded.paste(image, (0, 0))
        image = padded
    if settings.overlay != "none":
        text = f"{angle:.1f}°"
        if settings.overlay == "angle_and_frame":
            text = f"{text}  ·  Frame {frame_number} / {frame_count}"
        draw = ImageDraw.Draw(image)
        bounds = draw.textbbox((0, 0), text)
        padding = max(5, round(min(image.size) * 0.012))
        height = bounds[3] - bounds[1] + padding * 2
        draw.rectangle((0, image.height - height, image.width, image.height), fill=(0, 0, 0))
        draw.text((padding, image.height - height + padding), text, fill=(255, 255, 255))
    return image


def render_media_export(
    frame_paths: Sequence[Path],
    angles: Sequence[float],
    settings: MediaExportSettings,
    output_path: Path,
    *,
    on_progress: Callable[[float, str], None],
    is_cancelled: Callable[[], bool],
) -> None:
    indices = export_frame_indices(len(frame_paths), settings)
    if is_cancelled():
        raise ExportCancelled()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if settings.format == "gif":
        frames: list[Image.Image] = []
        colors = 256 if settings.gif_quality == "high" else 128
        dither = Image.Dither.FLOYDSTEINBERG if settings.dither else Image.Dither.NONE
        for position, index in enumerate(indices):
            if is_cancelled():
                raise ExportCancelled()
            image = _prepare_frame(
                frame_paths[index],
                angle=float(angles[index]),
                frame_number=index + 1,
                frame_count=len(frame_paths),
                settings=settings,
                even_dimensions=False,
            )
            frames.append(image.quantize(colors=colors, dither=dither))
            on_progress((position + 1) / len(indices) * 0.85, f"Preparing frame {position + 1} of {len(indices)}")
        on_progress(0.9, "Encoding GIF")
        save_options = {
            "save_all": True,
            "append_images": frames[1:],
            "duration": max(1, round(1000 / settings.fps)),
            "disposal": 2,
            "optimize": settings.gif_quality == "high",
        }
        if settings.loop:
            save_options["loop"] = 0
        frames[0].save(output_path, **save_options)
    else:
        quality = {"standard": 6, "high": 8, "maximum": 10}[settings.mp4_quality]
        writer = imageio.get_writer(
            output_path,
            format="FFMPEG",
            fps=settings.fps,
            codec="libx264",
            quality=quality,
            pixelformat="yuv420p",
            macro_block_size=1,
        )
        try:
            for position, index in enumerate(indices):
                if is_cancelled():
                    raise ExportCancelled()
                image = _prepare_frame(
                    frame_paths[index],
                    angle=float(angles[index]),
                    frame_number=index + 1,
                    frame_count=len(frame_paths),
                    settings=settings,
                    even_dimensions=True,
                )
                writer.append_data(np.asarray(image))
                on_progress((position + 1) / len(indices) * 0.95, f"Encoding frame {position + 1} of {len(indices)}")
        finally:
            writer.close()

    if is_cancelled():
        output_path.unlink(missing_ok=True)
        raise ExportCancelled()
    on_progress(1.0, f"{settings.format.upper()} ready")
