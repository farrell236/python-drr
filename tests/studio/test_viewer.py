import unittest

import numpy as np

from pydrr_studio.service import normalize_slice


class ViewerTests(unittest.TestCase):
    def test_window_level_clips_and_scales_slice(self) -> None:
        image = np.array([[-1000.0, -500.0, 0.0, 500.0, 1000.0]], dtype=np.float32)

        normalized = normalize_slice(image, window_center=0.0, window_width=1000.0)

        np.testing.assert_allclose(normalized, [[0.0, 0.0, 0.5, 1.0, 1.0]])

    def test_window_width_must_be_positive(self) -> None:
        with self.assertRaisesRegex(ValueError, "greater than zero"):
            normalize_slice(np.zeros((2, 2), dtype=np.float32), window_center=0.0, window_width=0.0)


if __name__ == "__main__":
    unittest.main()
