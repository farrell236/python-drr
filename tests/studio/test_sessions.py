import io
import subprocess
import unittest
from unittest.mock import patch

import numpy as np

from pydrr.volume import Volume
from pydrr_studio.models import RenderSettings
from pydrr_studio.service import JobRecord, StudioService, VolumeRecord


class StudioSessionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = StudioService()
        self.volume = Volume(
            data=np.zeros((3, 4, 5), dtype=np.float32),
            spacing_zyx=np.ones(3, dtype=np.float32),
            origin_zyx=np.zeros(3, dtype=np.float32),
            direction=np.eye(3, dtype=np.float32),
        )

    def tearDown(self) -> None:
        self.service.close()

    @patch("pydrr_studio.service.load_volume_sitk")
    def test_session_can_be_detected_updated_and_discarded(self, load_volume) -> None:
        load_volume.return_value = self.volume
        payload = b"test-nifti-content"

        volume_info = self.service.save_volume(io.BytesIO(payload), "scan.nii.gz")
        snapshot = self.service.session_snapshot()

        self.assertTrue(snapshot.active)
        self.assertEqual(snapshot.session_id, volume_info.session_id)
        self.assertEqual(snapshot.volume.filename, "scan.nii.gz")
        record = self.service.get_volume(volume_info.id)
        self.assertEqual(record.file_size_bytes, len(payload))
        self.assertEqual(len(record.sha256), 64)

        self.service.jobs["job"] = JobRecord(
            id="job",
            kind="render",
            status="completed",
            session_id=snapshot.session_id,
        )
        updated = self.service.update_session_state(snapshot.session_id, {"workspace": "results"})
        self.assertEqual(updated.state, {"workspace": "results"})
        self.assertEqual([job.id for job in updated.jobs], ["job"])

        self.service.discard_session(snapshot.session_id)
        self.assertFalse(self.service.session_snapshot().active)
        self.assertNotIn(volume_info.id, self.service.volumes)
        self.assertNotIn("job", self.service.jobs)

    def test_batch_frame_lookup_is_bounded_and_rejects_render_jobs(self) -> None:
        batch = JobRecord(id="batch", kind="batch")
        self.service.jobs[batch.id] = batch
        frames = self.service.root / "jobs" / batch.id / "frames"
        frames.mkdir(parents=True)
        (frames / "frame_0000.png").write_bytes(b"png")

        self.assertEqual(self.service.batch_frame_path(batch.id, 0).name, "frame_0000.png")
        with self.assertRaises(IndexError):
            self.service.batch_frame_path(batch.id, 1)

        self.service.jobs["render"] = JobRecord(id="render", kind="render")
        with self.assertRaises(ValueError):
            self.service.batch_frame_path("render", 0)

    def test_completed_batch_exports_manifest_and_valid_shell_script(self) -> None:
        volume_path = self.service.root / "scan.nii.gz"
        volume_path.write_bytes(b"nifti")
        self.service.volumes["volume"] = VolumeRecord(
            id="volume",
            filename="scan.nii.gz",
            path=volume_path,
            volume=self.volume,
        )
        job_dir = self.service.root / "jobs" / "batch"
        job_dir.mkdir(parents=True)
        manifest = job_dir / "manifest.json"
        manifest.write_text("{}")
        render = RenderSettings(volume_id="volume", backend="cpu", cpu_workers=2)
        self.service.jobs["batch"] = JobRecord(
            id="batch",
            kind="batch",
            status="completed",
            metadata={
                "angles_deg": [0.0, 45.0, 90.0],
                "render_settings": render.model_dump(mode="json"),
            },
        )

        self.assertEqual(self.service.batch_manifest_path("batch"), manifest)
        filename, script = self.service.batch_acquisition_script("batch")
        script_path = self.service.root / filename
        script_path.write_text(script)
        syntax = subprocess.run(
            ["bash", "-n", str(script_path)],
            capture_output=True,
            check=False,
            text=True,
        )

        self.assertEqual(syntax.returncode, 0, syntax.stderr)
        self.assertIn("ANGLES=(0 45 90)", script)
        self.assertIn("--projection-angle=\"$angle\"", script)
        self.assertIn("--n-cores 2", script)


if __name__ == "__main__":
    unittest.main()
