import unittest
from pathlib import Path

import numpy as np

from pydrr.geometry import make_orbit_pose
from pydrr.volume import Volume, volume_center_world_xyz
from pydrr_studio.models import RenderSettings
from pydrr_studio.service import StudioService, VolumeRecord, build_geometry


class StudioGeometryTests(unittest.TestCase):
    def setUp(self):
        self.volume = Volume(
            data=np.zeros((5, 7, 9), dtype=np.float32),
            spacing_zyx=np.array([1.2, 0.9, 0.7], dtype=np.float32),
            origin_zyx=np.array([4.0, -8.0, 12.0], dtype=np.float32),
            direction=np.eye(3, dtype=np.float32),
        )
        self.settings = RenderSettings(
            volume_id="volume",
            projection_angle_deg=42.0,
            orbit_tilt_x_deg=17.0,
            orbit_tilt_y_deg=-9.0,
            detector_roll_deg=13.0,
            detector_offset_u_mm=2.5,
            detector_offset_v_mm=-1.5,
        )

    def test_studio_uses_core_orbit_builder(self):
        actual, actual_isocenter = build_geometry(self.volume, self.settings)
        expected_isocenter = volume_center_world_xyz(self.volume)
        expected = make_orbit_pose(
            iso_center_mm=expected_isocenter,
            projection_angle_deg=self.settings.projection_angle_deg,
            sid_mm=self.settings.sid_mm,
            idd_mm=self.settings.idd_mm,
            orbit_tilt_x_deg=self.settings.orbit_tilt_x_deg,
            orbit_tilt_y_deg=self.settings.orbit_tilt_y_deg,
            detector_roll_deg=self.settings.detector_roll_deg,
            detector_offset_u_mm=self.settings.detector_offset_u_mm,
            detector_offset_v_mm=self.settings.detector_offset_v_mm,
            detector_size_px=(self.settings.detector_height_px, self.settings.detector_width_px),
            detector_spacing_mm=(self.settings.detector_row_spacing_mm, self.settings.detector_col_spacing_mm),
        )
        np.testing.assert_allclose(actual_isocenter, expected_isocenter, atol=1e-5)
        np.testing.assert_allclose(actual.source_mm, expected.source_mm, atol=1e-5)
        np.testing.assert_allclose(actual.detector_center_mm, expected.detector_center_mm, atol=1e-5)
        np.testing.assert_allclose(actual.detector_u_mm, expected.detector_u_mm, atol=1e-6)
        np.testing.assert_allclose(actual.detector_v_mm, expected.detector_v_mm, atol=1e-6)

    def test_studio_defaults_to_automatic_backend_selection(self):
        settings = RenderSettings(volume_id="volume")
        self.assertEqual(settings.backend, "auto")

    def test_exported_script_uses_new_unambiguous_flags(self):
        service = StudioService()
        try:
            service.volumes["volume"] = VolumeRecord(
                id="volume",
                filename="scan.nii.gz",
                path=Path("scan.nii.gz"),
                volume=self.volume,
            )
            _, script = service.acquisition_script(self.settings)
        finally:
            service.close()

        self.assertIn("--projection-angle=42", script)
        self.assertIn("--orbit-tilt-x=17", script)
        self.assertIn("--orbit-tilt-y=-9", script)
        self.assertIn("--detector-roll=13", script)
        self.assertIn('"$PYTHON_BIN" -m pydrr "$INPUT_VOLUME"', script)
        self.assertNotIn("get_drr_siddon_jacobs.py", script)
        self.assertNotIn("  -rx ", script)
        self.assertNotIn("  -ry ", script)
        self.assertNotIn("  -rz ", script)


if __name__ == "__main__":
    unittest.main()
