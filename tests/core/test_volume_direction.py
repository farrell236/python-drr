import unittest

import numpy as np

from pydrr.backends.cpu import ray_integral_siddon_jacobs
from pydrr.volume import (
    Volume,
    volume_center_world_xyz,
    voxel_zyx_to_world_xyz,
    world_xyz_to_voxel_zyx,
)


class VolumeDirectionTests(unittest.TestCase):
    def setUp(self):
        self.direction = np.array(
            [[0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]],
            dtype=np.float32,
        )
        self.spacing_zyx = np.array([2.0, 1.5, 0.75], dtype=np.float32)
        self.origin_zyx = np.array([30.0, 20.0, 10.0], dtype=np.float32)

    def test_voxel_world_round_trip_honors_direction(self):
        points_zyx = np.array([[0.0, 0.0, 0.0], [2.5, 3.0, 4.5]], dtype=np.float32)
        world = voxel_zyx_to_world_xyz(
            points_zyx,
            self.spacing_zyx,
            self.origin_zyx,
            self.direction,
        )
        recovered = world_xyz_to_voxel_zyx(
            world,
            self.spacing_zyx,
            self.origin_zyx,
            self.direction,
        )
        np.testing.assert_allclose(recovered, points_zyx, atol=1e-5)

    def test_volume_center_uses_direction(self):
        volume = Volume(
            data=np.zeros((3, 5, 7), dtype=np.float32),
            spacing_zyx=self.spacing_zyx,
            origin_zyx=self.origin_zyx,
            direction=self.direction,
        )
        center_zyx = np.array([[1.0, 2.0, 3.0]], dtype=np.float32)
        expected = voxel_zyx_to_world_xyz(
            center_zyx,
            self.spacing_zyx,
            self.origin_zyx,
            self.direction,
        )[0]
        np.testing.assert_allclose(volume_center_world_xyz(volume), expected, atol=1e-5)

    def test_ray_integral_is_invariant_to_volume_direction(self):
        data = np.ones((1, 1, 4), dtype=np.float32)
        spacing = np.ones(3, dtype=np.float32)
        origin = np.zeros(3, dtype=np.float32)
        identity_volume = Volume(data, spacing, origin, np.eye(3, dtype=np.float32))
        rotated_volume = Volume(data, spacing, origin, self.direction)

        start_local = np.array([-1.0, 0.5, 0.5])
        end_local = np.array([5.0, 0.5, 0.5])
        start_world = self.direction @ start_local
        end_world = self.direction @ end_local

        identity_value = ray_integral_siddon_jacobs(
            identity_volume,
            start_local,
            end_local,
            hu_air_threshold=None,
            clamp_negative_to_zero=False,
        )
        rotated_value = ray_integral_siddon_jacobs(
            rotated_volume,
            start_world,
            end_world,
            hu_air_threshold=None,
            clamp_negative_to_zero=False,
        )
        self.assertAlmostEqual(identity_value, 4.0, places=5)
        self.assertAlmostEqual(rotated_value, identity_value, places=5)


if __name__ == "__main__":
    unittest.main()
