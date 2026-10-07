import unittest

import numpy as np

from pydrr.geometry import detector_pixel_centers_world, make_orbit_frame, make_orbit_pose


class OrbitGeometryTests(unittest.TestCase):
    def test_default_orbit_pose(self):
        geometry = make_orbit_pose(
            iso_center_mm=np.zeros(3),
            projection_angle_deg=0.0,
            sid_mm=1000.0,
            idd_mm=500.0,
        )

        np.testing.assert_allclose(geometry.source_mm, [1000.0, 0.0, 0.0], atol=1e-5)
        np.testing.assert_allclose(geometry.detector_center_mm, [-500.0, 0.0, 0.0], atol=1e-5)
        np.testing.assert_allclose(geometry.detector_u_mm, [0.0, 1.0, 0.0], atol=1e-6)
        np.testing.assert_allclose(geometry.detector_v_mm, [0.0, 0.0, 1.0], atol=1e-6)

    def test_projection_angle_stays_in_tilted_orbit_plane(self):
        frame = make_orbit_frame(tilt_x_deg=27.0, tilt_y_deg=-18.0)
        isocenter = np.array([8.0, -3.0, 11.0])

        for angle in (0.0, 37.0, 90.0, 231.0):
            geometry = make_orbit_pose(
                iso_center_mm=isocenter,
                projection_angle_deg=angle,
                sid_mm=720.0,
                idd_mm=340.0,
                orbit_tilt_x_deg=27.0,
                orbit_tilt_y_deg=-18.0,
            )
            source_offset = geometry.source_mm - isocenter
            detector_offset = geometry.detector_center_mm - isocenter
            self.assertAlmostEqual(float(np.linalg.norm(source_offset)), 720.0, places=4)
            self.assertAlmostEqual(float(np.linalg.norm(detector_offset)), 340.0, places=4)
            self.assertAlmostEqual(float(np.dot(source_offset, frame.normal_world)), 0.0, places=4)
            self.assertAlmostEqual(float(np.dot(detector_offset, frame.normal_world)), 0.0, places=4)

    def test_detector_roll_only_changes_detector_basis(self):
        base = make_orbit_pose(np.zeros(3), 35.0, detector_roll_deg=0.0)
        rolled = make_orbit_pose(np.zeros(3), 35.0, detector_roll_deg=90.0)

        np.testing.assert_allclose(rolled.source_mm, base.source_mm, atol=1e-5)
        np.testing.assert_allclose(rolled.detector_center_mm, base.detector_center_mm, atol=1e-5)
        np.testing.assert_allclose(rolled.detector_u_mm, base.detector_v_mm, atol=1e-6)
        np.testing.assert_allclose(rolled.detector_v_mm, -base.detector_u_mm, atol=1e-6)

    def test_detector_offsets_follow_rolled_detector_axes(self):
        base = make_orbit_pose(np.zeros(3), 0.0, detector_roll_deg=30.0)
        shifted = make_orbit_pose(
            np.zeros(3),
            0.0,
            detector_roll_deg=30.0,
            detector_offset_u_mm=12.0,
            detector_offset_v_mm=-7.0,
        )
        expected_shift = 12.0 * base.detector_u_mm - 7.0 * base.detector_v_mm
        np.testing.assert_allclose(
            shifted.detector_center_mm - base.detector_center_mm,
            expected_shift,
            atol=1e-5,
        )

    def test_detector_rows_follow_image_top_to_bottom_convention(self):
        geometry = make_orbit_pose(
            np.zeros(3),
            0.0,
            detector_size_px=(3, 3),
            detector_spacing_mm=(2.0, 4.0),
        )

        pixels = detector_pixel_centers_world(geometry)
        np.testing.assert_allclose(
            pixels[0, 1],
            geometry.detector_center_mm + 2.0 * geometry.detector_v_mm,
            atol=1e-6,
        )
        np.testing.assert_allclose(
            pixels[2, 1],
            geometry.detector_center_mm - 2.0 * geometry.detector_v_mm,
            atol=1e-6,
        )
        np.testing.assert_allclose(
            pixels[1, 0],
            geometry.detector_center_mm - 4.0 * geometry.detector_u_mm,
            atol=1e-6,
        )


if __name__ == "__main__":
    unittest.main()
