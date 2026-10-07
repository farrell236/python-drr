import json
import tempfile
import unittest
import zipfile
from pathlib import Path

import numpy as np

from pydrr.volume import Volume
from pydrr_studio.models import BatchSettings, RenderSettings
from pydrr_studio.worker import _run_batch


class BatchWorkerTests(unittest.TestCase):
    def test_normalization_and_raw_export_combinations_keep_expected_outputs(self):
        volume = Volume(
            data=np.arange(4 * 4 * 4, dtype=np.float32).reshape(4, 4, 4),
            spacing_zyx=np.ones(3, dtype=np.float32),
            origin_zyx=np.zeros(3, dtype=np.float32),
            direction=np.eye(3, dtype=np.float32),
        )
        render = RenderSettings(
            volume_id="volume",
            detector_height_px=16,
            detector_width_px=16,
            sid_mm=12,
            idd_mm=6,
            backend="cpu",
        )

        for shared_normalization in (False, True):
            for include_raw in (False, True):
                with self.subTest(
                    shared_normalization=shared_normalization,
                    include_raw=include_raw,
                ), tempfile.TemporaryDirectory() as directory:
                    output_dir = Path(directory)
                    settings = BatchSettings(
                        render=render,
                        start_angle_deg=0,
                        end_angle_deg=0,
                        step_deg=5,
                        shared_normalization=shared_normalization,
                        include_raw=include_raw,
                    )
                    result = _run_batch(
                        {
                            "volume_id": "volume",
                            "volume_filename": "volume.nii.gz",
                            "batch": settings.model_dump(mode="json"),
                        },
                        output_dir,
                        volume,
                    )

                    archive_path = Path(result["archive_path"])
                    with zipfile.ZipFile(archive_path) as archive:
                        names = archive.namelist()
                        manifest = json.loads(archive.read("manifest.json"))
                    self.assertEqual(sum(name.endswith(".png") for name in names), 1)
                    self.assertEqual(any(name.endswith(".npy") for name in names), include_raw)
                    self.assertEqual(manifest["shared_normalization"], shared_normalization)
                    self.assertEqual(manifest["angles_deg"], [0.0])


if __name__ == "__main__":
    unittest.main()
