import unittest
from unittest import mock

import numpy as np

from pydrr.backends import BackendStatus, resolve_backend
from pydrr.backends.mps import _render_drr_torch
from pydrr.geometry import make_orbit_pose
from pydrr.renderer import generate_drr
from pydrr.volume import Volume, volume_center_world_xyz


class BackendSelectionTests(unittest.TestCase):
    def test_automatic_prefers_mps_then_cpu(self):
        statuses = (
            BackendStatus("cpu", "CPU", True, "ready"),
            BackendStatus("mps", "Apple GPU (MPS)", True, "ready"),
            BackendStatus("cuda", "NVIDIA GPU (CUDA)", False, "unavailable"),
        )
        with mock.patch("pydrr.backends.registry.backend_statuses", return_value=statuses):
            self.assertEqual(resolve_backend("auto"), "mps")

    def test_unavailable_explicit_backend_has_clear_error(self):
        statuses = (
            BackendStatus("cpu", "CPU", True, "ready"),
            BackendStatus("mps", "Apple GPU (MPS)", False, "PyTorch cannot access MPS."),
            BackendStatus("cuda", "NVIDIA GPU (CUDA)", False, "unavailable"),
        )
        with mock.patch("pydrr.backends.registry.backend_statuses", return_value=statuses):
            with self.assertRaisesRegex(RuntimeError, "PyTorch cannot access MPS"):
                resolve_backend("mps")


class TorchProjectorTests(unittest.TestCase):
    def test_tensor_projector_matches_cpu_siddon_projector(self):
        data = np.arange(6 * 7 * 8, dtype=np.float32).reshape(6, 7, 8)
        volume = Volume(
            data=data,
            spacing_zyx=np.array([1.4, 1.1, 0.8], dtype=np.float32),
            origin_zyx=np.array([4.0, -2.0, 7.0], dtype=np.float32),
            direction=np.eye(3, dtype=np.float32),
        )
        geometry = make_orbit_pose(
            iso_center_mm=volume_center_world_xyz(volume),
            projection_angle_deg=31.0,
            sid_mm=35.0,
            idd_mm=22.0,
            detector_size_px=(6, 7),
            detector_spacing_mm=(0.7, 0.7),
        )
        expected = generate_drr(
            volume,
            geometry,
            backend="cpu",
            show_progress=False,
            projector_kwargs={"hu_air_threshold": None, "clamp_negative_to_zero": False},
        )
        actual = _render_drr_torch(
            volume,
            geometry,
            device="cpu",
            hu_air_threshold=None,
            clamp_negative_to_zero=False,
        )
        np.testing.assert_allclose(actual, expected, rtol=2e-5, atol=2e-3)


if __name__ == "__main__":
    unittest.main()
