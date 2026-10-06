import unittest

from pydantic import ValidationError

from pydrr_studio.models import RenderSettings


class RenderSettingsTests(unittest.TestCase):
    def test_accepts_2048_pixel_detector(self) -> None:
        settings = RenderSettings(
            volume_id="volume",
            detector_width_px=2048,
            detector_height_px=2048,
        )

        self.assertEqual(settings.detector_width_px, 2048)
        self.assertEqual(settings.detector_height_px, 2048)

    def test_rejects_detector_larger_than_2048_pixels(self) -> None:
        with self.assertRaises(ValidationError):
            RenderSettings(volume_id="volume", detector_width_px=2049)


if __name__ == "__main__":
    unittest.main()
