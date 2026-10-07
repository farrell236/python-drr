import importlib.util
import unittest
from unittest import mock

import numpy as np

from pydrr.backends import BackendStatus, resolve_backend
from pydrr.attenuation import transform_voxel_value
from pydrr.backends.cpu import ray_integral_siddon_jacobs
from pydrr.backends.mps import _prepare_volume_torch, _render_drr_torch
from pydrr.geometry import detector_pixel_centers_world, make_orbit_pose
from pydrr.renderer import generate_drr
from pydrr.volume import Volume, volume_center_world_xyz, world_xyz_to_image_physical_xyz


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
        status = BackendStatus(
            "mps", "Apple GPU (MPS)", False, "PyTorch cannot access MPS."
        )
        with mock.patch("pydrr.backends.registry._mps_status", return_value=status):
            with self.assertRaisesRegex(RuntimeError, "PyTorch cannot access MPS"):
                resolve_backend("mps")

    def test_explicit_cpu_does_not_probe_accelerators(self):
        with (
            mock.patch("pydrr.backends.registry._mps_status") as mps_status,
            mock.patch("pydrr.backends.registry._cuda_status") as cuda_status,
        ):
            self.assertEqual(resolve_backend("cpu"), "cpu")
        mps_status.assert_not_called()
        cuda_status.assert_not_called()


class ProjectionModelTests(unittest.TestCase):
    def test_relative_attenuation_uses_water_referenced_hu_scale(self):
        self.assertEqual(transform_voxel_value(-1000, projection_model="relative_attenuation", hu_air_threshold=None), 0.0)
        self.assertEqual(transform_voxel_value(0, projection_model="relative_attenuation", hu_air_threshold=None), 1.0)
        self.assertEqual(transform_voxel_value(1000, projection_model="relative_attenuation", hu_air_threshold=None), 2.0)

    def test_air_threshold_is_applied_before_relative_conversion(self):
        self.assertEqual(transform_voxel_value(-950, projection_model="relative_attenuation", hu_air_threshold=-900), 0.0)

    def test_tensor_relative_projector_matches_cpu(self):
        if importlib.util.find_spec("torch") is None:
            self.skipTest("PyTorch is not installed")
        data = np.array([[[-1000, -500], [0, 1000]], [[250, 500], [750, 1000]]], dtype=np.float32)
        volume = Volume(
            data=data,
            spacing_zyx=np.ones(3, dtype=np.float32),
            origin_zyx=np.zeros(3, dtype=np.float32),
            direction=np.eye(3, dtype=np.float32),
        )
        geometry = make_orbit_pose(
            iso_center_mm=volume_center_world_xyz(volume),
            projection_angle_deg=17.0,
            sid_mm=8.0,
            idd_mm=5.0,
            detector_size_px=(3, 3),
            detector_spacing_mm=(0.6, 0.6),
        )
        kwargs = {"hu_air_threshold": -900.0, "clamp_negative_to_zero": True, "projection_model": "relative_attenuation"}
        expected = generate_drr(volume, geometry, backend="cpu", show_progress=False, projector_kwargs=kwargs)
        prepared = _prepare_volume_torch(volume, "cpu")
        actual = _render_drr_torch(
            volume,
            geometry,
            device="cpu",
            prepared_volume=prepared,
            **kwargs,
        )
        np.testing.assert_allclose(actual, expected, rtol=2e-5, atol=2e-4)


class CpuProjectorEfficiencyTests(unittest.TestCase):
    def test_generate_drr_pretransforms_reference_projector_coordinates(self):
        direction = np.array(
            [[0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]],
            dtype=np.float32,
        )
        volume = Volume(
            data=np.arange(5 * 6 * 7, dtype=np.float32).reshape(5, 6, 7),
            spacing_zyx=np.array([1.4, 1.1, 0.8], dtype=np.float32),
            origin_zyx=np.array([4.0, -2.0, 7.0], dtype=np.float32),
            direction=direction,
        )
        geometry = make_orbit_pose(
            volume_center_world_xyz(volume),
            23.0,
            sid_mm=35.0,
            idd_mm=22.0,
            detector_size_px=(4, 5),
            detector_spacing_mm=(0.7, 0.7),
        )
        kwargs = {"hu_air_threshold": None, "clamp_negative_to_zero": False}
        detector_points = detector_pixel_centers_world(geometry)
        expected = np.array([
            [
                ray_integral_siddon_jacobs(
                    volume,
                    geometry.source_mm,
                    endpoint,
                    **kwargs,
                )
                for endpoint in row
            ]
            for row in detector_points
        ], dtype=np.float32)

        with mock.patch(
            "pydrr.renderer.world_xyz_to_image_physical_xyz",
            wraps=world_xyz_to_image_physical_xyz,
        ) as transform:
            actual = generate_drr(
                volume,
                geometry,
                backend="cpu",
                show_progress=False,
                projector_kwargs=kwargs,
            )

        self.assertEqual(transform.call_count, 2)
        np.testing.assert_allclose(actual, expected, rtol=1e-6, atol=1e-5)


class TorchProjectorTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("torch"), "PyTorch is not installed")
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
