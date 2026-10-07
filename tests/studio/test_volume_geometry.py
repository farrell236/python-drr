import tempfile
import unittest
from pathlib import Path

import numpy as np

from pydrr.volume import Volume
from pydrr_studio.models import RenderSettings
from pydrr_studio.service import StudioService, VolumeRecord


class VolumeGeometryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = StudioService()
        self.directory = tempfile.TemporaryDirectory()

    def tearDown(self) -> None:
        self.service.close()
        self.directory.cleanup()

    def add_volume(self, direction: np.ndarray) -> None:
        volume = Volume(
            data=np.arange(24, dtype=np.float32).reshape(2, 3, 4),
            spacing_zyx=np.array([2.0, 1.5, 1.0], dtype=np.float32),
            origin_zyx=np.array([30.0, 20.0, 10.0], dtype=np.float32),
            direction=direction.astype(np.float32),
        )
        self.service.volumes["volume"] = VolumeRecord(
            id="volume",
            filename="volume.nii.gz",
            path=Path(self.directory.name) / "volume.nii.gz",
            volume=volume,
        )

    def test_voxel_sample_returns_nearest_value_and_world_position(self):
        self.add_volume(np.eye(3))
        sample = self.service.voxel_sample("volume", (0.7, 1.2, 2.6))
        self.assertEqual(sample.voxel_zyx, (1, 1, 3))
        self.assertEqual(sample.intensity, 19.0)
        self.assertEqual(sample.world_xyz_mm, (13.0, 21.5, 32.0))

    def test_non_orthonormal_direction_blocks_acquisition(self):
        direction = np.eye(3)
        direction[0, 1] = 0.2
        self.add_volume(direction)
        info = self.service.volume_info(self.service.get_volume("volume"))
        self.assertFalse(info.geometry_valid)
        self.assertIn("not orthonormal", info.orientation_warning or "")
        with self.assertRaisesRegex(ValueError, "not orthonormal"):
            self.service.create_render(RenderSettings(volume_id="volume"))


if __name__ == "__main__":
    unittest.main()
