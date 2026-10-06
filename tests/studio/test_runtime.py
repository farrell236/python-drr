import sys
import tempfile
import time
import unittest
from pathlib import Path

import numpy as np
import SimpleITK as sitk

from pydrr.volume import load_volume_sitk
from pydrr_studio.models import BatchSettings, RenderSettings
from pydrr_studio.runtime import RuntimeManager
from pydrr_studio.service import StudioService, VolumeRecord


class StudioRuntimeTests(unittest.TestCase):
    def test_runtime_manager_probes_and_selects_an_interpreter(self):
        manager = RuntimeManager()
        try:
            info = manager.select(sys.executable)
            self.assertTrue(info.ready)
            self.assertEqual(Path(info.python_executable), Path(sys.executable).absolute())
            self.assertTrue(any(candidate.is_server_python for candidate in info.candidates))
        finally:
            manager.close()

    def test_render_worker_uses_the_selected_interpreter(self):
        manager = RuntimeManager()
        service = StudioService(manager)
        try:
            with tempfile.TemporaryDirectory() as directory:
                volume_path = Path(directory) / "volume.nii.gz"
                image = sitk.GetImageFromArray(np.full((4, 4, 4), 1000, dtype=np.int16))
                sitk.WriteImage(image, str(volume_path))
                volume = load_volume_sitk(str(volume_path))
                service.volumes["volume"] = VolumeRecord(
                    id="volume",
                    filename=volume_path.name,
                    path=volume_path,
                    volume=volume,
                )
                job = service.create_render(RenderSettings(
                    volume_id="volume",
                    detector_height_px=16,
                    detector_width_px=16,
                    backend="cpu",
                ))
                deadline = time.time() + 30
                while job.status in {"queued", "running"} and time.time() < deadline:
                    time.sleep(0.1)
                self.assertEqual(job.status, "completed", job.error)
                self.assertTrue(job.image_path and job.image_path.is_file())
                self.assertEqual(
                    Path(job.metadata["compute"]["python_executable"]),
                    Path(sys.executable).absolute(),
                )

                batch = service.create_batch(BatchSettings(
                    render=RenderSettings(
                        volume_id="volume",
                        detector_height_px=16,
                        detector_width_px=16,
                        backend="cpu",
                    ),
                    start_angle_deg=0,
                    end_angle_deg=10,
                    step_deg=10,
                    include_raw=False,
                ))
                deadline = time.time() + 30
                while batch.status in {"queued", "running"} and time.time() < deadline:
                    time.sleep(0.1)
                self.assertEqual(batch.status, "completed", batch.error)
                self.assertTrue(batch.archive_path and batch.archive_path.is_file())
                self.assertEqual(batch.metadata["angles_deg"], [0.0, 10.0])
        finally:
            service.close()
            manager.close()


if __name__ == "__main__":
    unittest.main()
