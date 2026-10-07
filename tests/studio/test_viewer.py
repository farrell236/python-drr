import unittest

import numpy as np

from pydrr_studio.service import downsample_volume_for_rendering, normalize_slice


class ViewerTests(unittest.TestCase):
    def test_window_level_clips_and_scales_slice(self) -> None:
        image = np.array([[-1000.0, -500.0, 0.0, 500.0, 1000.0]], dtype=np.float32)

        normalized = normalize_slice(image, window_center=0.0, window_width=1000.0)

        np.testing.assert_allclose(normalized, [[0.0, 0.0, 0.5, 1.0, 1.0]])

    def test_window_width_must_be_positive(self) -> None:
        with self.assertRaisesRegex(ValueError, "greater than zero"):
            normalize_slice(np.zeros((2, 2), dtype=np.float32), window_center=0.0, window_width=0.0)

    def test_rendering_copy_is_bounded_and_preserves_extent(self) -> None:
        data = np.arange(21 * 41 * 81, dtype=np.float32).reshape(21, 41, 81)
        spacing = np.array([3.0, 1.5, 0.75], dtype=np.float32)

        sampled, sampled_spacing = downsample_volume_for_rendering(
            data,
            spacing,
            max_dimension=32,
        )

        self.assertEqual(sampled.shape, (8, 16, 32))
        self.assertEqual(sampled.dtype, np.dtype("float32"))
        np.testing.assert_allclose(
            (np.array(sampled.shape) - 1) * sampled_spacing,
            (np.array(data.shape) - 1) * spacing,
        )
        self.assertEqual(sampled[0, 0, 0], data[0, 0, 0])
        self.assertEqual(sampled[-1, -1, -1], data[-1, -1, -1])

    def test_rendering_copy_sanitizes_non_finite_values(self) -> None:
        data = np.zeros((4, 4, 4), dtype=np.float32)
        data[0, 0, 0] = np.nan
        data[-1, -1, -1] = np.inf

        sampled, _ = downsample_volume_for_rendering(
            data,
            np.ones(3, dtype=np.float32),
            max_dimension=32,
        )

        self.assertTrue(np.isfinite(sampled).all())


if __name__ == "__main__":
    unittest.main()
