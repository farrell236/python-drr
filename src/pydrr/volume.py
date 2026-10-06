from dataclasses import dataclass
from typing import Tuple

import numpy as np
import SimpleITK as sitk


@dataclass
class Volume:
    """3D volume and its SimpleITK physical-coordinate transform.

    Attributes:
        data: Volume intensities with shape (Z, Y, X).
        spacing_zyx: Voxel spacing in mm as (sz, sy, sx).
        origin_zyx: World origin in mm as (oz, oy, ox).
        direction: SimpleITK direction matrix mapping image XYZ axes into
            physical world XYZ coordinates.
    """

    data: np.ndarray
    spacing_zyx: np.ndarray
    origin_zyx: np.ndarray
    direction: np.ndarray

    @property
    def shape_zyx(self) -> Tuple[int, int, int]:
        return self.data.shape


def load_volume_sitk(path: str) -> Volume:
    """Load a 3D volume from disk with SimpleITK.

    Returns:
        Volume with array data in (Z, Y, X) order.
    """
    img = sitk.ReadImage(path)
    arr = sitk.GetArrayFromImage(img).astype(np.float32)  # (Z, Y, X)

    spacing_xyz = np.array(img.GetSpacing(), dtype=np.float32)
    origin_xyz = np.array(img.GetOrigin(), dtype=np.float32)
    direction = np.array(img.GetDirection(), dtype=np.float32).reshape(3, 3)

    return Volume(
        data=arr,
        spacing_zyx=spacing_xyz[::-1].copy(),
        origin_zyx=origin_xyz[::-1].copy(),
        direction=direction,
    )


def voxel_zyx_to_world_xyz(
    ijk_zyx: np.ndarray,
    spacing_zyx: np.ndarray,
    origin_zyx: np.ndarray,
    direction: np.ndarray | None = None,
) -> np.ndarray:
    """Convert continuous voxel indices in ZYX order to physical world XYZ."""
    ijk_zyx = np.asarray(ijk_zyx, dtype=np.float32)
    spacing_xyz = np.asarray(spacing_zyx, dtype=np.float32)[::-1]
    origin_xyz = np.asarray(origin_zyx, dtype=np.float32)[::-1]
    direction = np.eye(3, dtype=np.float32) if direction is None else np.asarray(direction, dtype=np.float32)
    image_physical_xyz = ijk_zyx[..., ::-1] * spacing_xyz
    return image_physical_xyz @ direction.T + origin_xyz


def world_xyz_to_voxel_zyx(
    xyz_mm: np.ndarray,
    spacing_zyx: np.ndarray,
    origin_zyx: np.ndarray,
    direction: np.ndarray | None = None,
) -> np.ndarray:
    """Convert physical world XYZ coordinates to continuous voxel ZYX indices."""
    xyz_mm = np.asarray(xyz_mm, dtype=np.float32)
    spacing_xyz = np.asarray(spacing_zyx, dtype=np.float32)[::-1]
    origin_xyz = np.asarray(origin_zyx, dtype=np.float32)[::-1]
    direction = np.eye(3, dtype=np.float32) if direction is None else np.asarray(direction, dtype=np.float32)
    image_physical_xyz = (xyz_mm - origin_xyz) @ np.linalg.inv(direction).T
    return (image_physical_xyz / spacing_xyz)[..., ::-1]


def world_xyz_to_image_physical_xyz(vol: Volume, xyz_mm: np.ndarray) -> np.ndarray:
    """Map world XYZ points into the volume's axis-aligned physical frame.

    The returned coordinates are measured in millimetres from voxel index zero
    along the image X, Y and Z axes. Transforming rays into this frame lets the
    Siddon projector handle arbitrary orthonormal SimpleITK direction matrices
    without resampling the image.
    """
    xyz_mm = np.asarray(xyz_mm, dtype=np.float64)
    origin_xyz = np.asarray(vol.origin_zyx, dtype=np.float64)[::-1]
    direction = np.asarray(vol.direction, dtype=np.float64)
    return (xyz_mm - origin_xyz) @ np.linalg.inv(direction).T


def volume_center_world_xyz(vol: Volume) -> np.ndarray:
    """Return the center of the volume in world xyz coordinates."""
    shape_zyx = np.array(vol.shape_zyx, dtype=np.float32)
    center_zyx = (shape_zyx - 1.0) / 2.0
    return voxel_zyx_to_world_xyz(
        center_zyx[None],
        vol.spacing_zyx,
        vol.origin_zyx,
        vol.direction,
    )[0]
