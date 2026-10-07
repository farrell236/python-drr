import tempfile
import unittest
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image

from pydrr_studio.media_export import export_frame_indices, render_media_export
from pydrr_studio.models import MediaExportSettings


class MediaExportTests(unittest.TestCase):
    def _frames(self, directory: Path) -> tuple[list[Path], list[float]]:
        paths = []
        for index, value in enumerate((24, 112, 220)):
            data = np.full((18, 20, 3), value, dtype=np.uint8)
            data[:, index * 3:index * 3 + 2, 0] = 255
            path = directory / f"frame_{index:04d}.png"
            Image.fromarray(data).save(path)
            paths.append(path)
        return paths, [0.0, 10.0, 20.0]

    def test_frame_order_supports_ranges_reverse_and_ping_pong(self) -> None:
        reverse = MediaExportSettings(format="gif", start_frame=1, end_frame=3, direction="reverse")
        ping_pong = MediaExportSettings(format="gif", start_frame=0, end_frame=3, direction="ping-pong")

        self.assertEqual(export_frame_indices(5, reverse), [3, 2, 1])
        self.assertEqual(export_frame_indices(5, ping_pong), [0, 1, 2, 3, 2, 1])

    def test_gif_export_preserves_frames_and_optional_loop(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            frames, angles = self._frames(root)
            output = root / "sweep.gif"
            progress: list[float] = []
            settings = MediaExportSettings(
                format="gif",
                fps=10,
                loop=False,
                overlay="angle_and_frame",
                max_dimension_px=None,
            )

            render_media_export(
                frames,
                angles,
                settings,
                output,
                on_progress=lambda value, _message: progress.append(value),
                is_cancelled=lambda: False,
            )

            with Image.open(output) as image:
                self.assertEqual(image.n_frames, 3)
                self.assertNotIn("loop", image.info)
            self.assertEqual(progress[-1], 1.0)

    def test_mp4_export_uses_h264_compatible_even_frames(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            frames, angles = self._frames(root)
            output = root / "sweep.mp4"
            settings = MediaExportSettings(format="mp4", fps=12, max_dimension_px=None)

            render_media_export(
                frames,
                angles,
                settings,
                output,
                on_progress=lambda _value, _message: None,
                is_cancelled=lambda: False,
            )

            frame_count, _duration = imageio_ffmpeg.count_frames_and_secs(str(output))
            self.assertEqual(frame_count, 3)
            self.assertGreater(output.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
