import math
from dataclasses import dataclass
from typing import Tuple

import numpy as np


@dataclass
class DRRGeometry:
    """Single projection geometry definition."""

    source_mm: np.ndarray
    detector_center_mm: np.ndarray
    detector_u_mm: np.ndarray
    detector_v_mm: np.ndarray
    detector_size_px: Tuple[int, int]          # (H, W)
    detector_spacing_mm: Tuple[float, float]   # (row_spacing, col_spacing)


@dataclass(frozen=True)
class OrbitFrame:
    """Patient-fixed orthonormal frame for a circular acquisition orbit.

    ``x_world`` is the source direction at a projection angle of zero,
    ``y_world`` points toward increasing projection angle, and
    ``normal_world`` is the orbit-plane normal. All vectors use the same
    physical world coordinate system as ``DRRGeometry``.
    """

    x_world: np.ndarray
    y_world: np.ndarray
    normal_world: np.ndarray


def normalize(v: np.ndarray, eps: float = 1e-8) -> np.ndarray:
    """Return a unit vector."""
    n = np.linalg.norm(v)
    if n < eps:
        raise ValueError("Zero-length vector cannot be normalized.")
    return v / n


def make_orbit_frame(
    tilt_x_deg: float = 0.0,
    tilt_y_deg: float = 0.0,
) -> OrbitFrame:
    """Create a circular-orbit frame tilted about fixed world X and Y axes.

    The convention is deliberately not generic roll/pitch/yaw. A base orbit
    lies in the world XY plane. It is first tilted about the fixed world X
    axis, then about the fixed world Y axis. Projection angle is subsequently
    measured *inside* this fixed plane.
    """
    tx, ty = np.deg2rad([tilt_x_deg, tilt_y_deg])
    cx, sx = math.cos(tx), math.sin(tx)
    cy, sy = math.cos(ty), math.sin(ty)
    rotate_x = np.array(
        [[1.0, 0.0, 0.0], [0.0, cx, -sx], [0.0, sx, cx]],
        dtype=np.float64,
    )
    rotate_y = np.array(
        [[cy, 0.0, sy], [0.0, 1.0, 0.0], [-sy, 0.0, cy]],
        dtype=np.float64,
    )
    rotation = rotate_y @ rotate_x
    return OrbitFrame(
        x_world=rotation[:, 0].astype(np.float32),
        y_world=rotation[:, 1].astype(np.float32),
        normal_world=rotation[:, 2].astype(np.float32),
    )


def make_orbit_pose(
    iso_center_mm: np.ndarray,
    projection_angle_deg: float,
    sid_mm: float = 1000.0,
    idd_mm: float = 500.0,
    orbit_tilt_x_deg: float = 0.0,
    orbit_tilt_y_deg: float = 0.0,
    detector_roll_deg: float = 0.0,
    detector_offset_u_mm: float = 0.0,
    detector_offset_v_mm: float = 0.0,
    detector_size_px: Tuple[int, int] = (512, 512),
    detector_spacing_mm: Tuple[float, float] = (1.0, 1.0),
) -> DRRGeometry:
    """Construct one projection from a patient-fixed circular orbit.

    ``projection_angle_deg`` selects a position inside the orbit plane.
    ``orbit_tilt_x_deg`` and ``orbit_tilt_y_deg`` orient that plane relative
    to the physical world axes. ``detector_roll_deg`` rotates only the
    detector's in-plane U/V basis about the source-to-detector ray.
    """
    iso_center_mm = np.asarray(iso_center_mm, dtype=np.float64)
    if iso_center_mm.shape != (3,):
        raise ValueError("iso_center_mm must contain three world coordinates")
    if sid_mm <= 0.0:
        raise ValueError("sid_mm must be greater than zero")
    if idd_mm < 0.0:
        raise ValueError("idd_mm cannot be negative")

    frame = make_orbit_frame(orbit_tilt_x_deg, orbit_tilt_y_deg)
    theta = math.radians(projection_angle_deg)
    radial = normalize(
        math.cos(theta) * frame.x_world.astype(np.float64)
        + math.sin(theta) * frame.y_world.astype(np.float64)
    )
    tangent = normalize(
        -math.sin(theta) * frame.x_world.astype(np.float64)
        + math.cos(theta) * frame.y_world.astype(np.float64)
    )
    orbit_normal = normalize(frame.normal_world.astype(np.float64))

    source_mm = iso_center_mm + float(sid_mm) * radial
    detector_center_mm = iso_center_mm - float(idd_mm) * radial

    roll = math.radians(detector_roll_deg)
    detector_u_mm = normalize(math.cos(roll) * tangent + math.sin(roll) * orbit_normal)
    detector_v_mm = normalize(-math.sin(roll) * tangent + math.cos(roll) * orbit_normal)
    detector_center_mm = (
        detector_center_mm
        + float(detector_offset_u_mm) * detector_u_mm
        + float(detector_offset_v_mm) * detector_v_mm
    )

    return DRRGeometry(
        source_mm=source_mm.astype(np.float32),
        detector_center_mm=detector_center_mm.astype(np.float32),
        detector_u_mm=detector_u_mm.astype(np.float32),
        detector_v_mm=detector_v_mm.astype(np.float32),
        detector_size_px=detector_size_px,
        detector_spacing_mm=detector_spacing_mm,
    )


def make_detector_basis_from_forward(
    forward_xyz: np.ndarray,
    world_up_xyz: np.ndarray = np.array([0.0, 0.0, 1.0], dtype=np.float32),
) -> Tuple[np.ndarray, np.ndarray]:
    """Build detector basis vectors from source->detector direction."""
    f = normalize(forward_xyz)
    u = np.cross(f, world_up_xyz)

    if np.linalg.norm(u) < 1e-6:
        world_up_xyz = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        u = np.cross(f, world_up_xyz)

    u = normalize(u)
    v = normalize(np.cross(u, f))
    return u, v


def make_circular_orbit_pose(
    iso_center_mm: np.ndarray,
    angle_deg: float,
    sid_mm: float = 1000.0,
    idd_mm: float = 500.0,
    detector_size_px: Tuple[int, int] = (512, 512),
    detector_spacing_mm: Tuple[float, float] = (1.0, 1.0),
) -> DRRGeometry:
    """Backward-compatible untilted circular orbit pose."""
    return make_orbit_pose(
        iso_center_mm=iso_center_mm,
        projection_angle_deg=angle_deg,
        sid_mm=sid_mm,
        idd_mm=idd_mm,
        detector_size_px=detector_size_px,
        detector_spacing_mm=detector_spacing_mm,
    )


def detector_pixel_centers_world(geom: DRRGeometry) -> np.ndarray:
    """Return detector pixel centers as an image array of shape ``(H, W, 3)``.

    Image rows run from the positive detector V direction at the top to the
    negative V direction at the bottom. Columns run from negative detector U
    at the left to positive U at the right.
    """
    H, W = geom.detector_size_px
    row_spacing, col_spacing = geom.detector_spacing_mm

    rows = (H - 1) / 2.0 - np.arange(H, dtype=np.float32)
    cols = np.arange(W, dtype=np.float32) - (W - 1) / 2.0
    rr, cc = np.meshgrid(rows, cols, indexing="ij")

    pts = (
        geom.detector_center_mm[None, None, :]
        + rr[..., None] * row_spacing * geom.detector_v_mm[None, None, :]
        + cc[..., None] * col_spacing * geom.detector_u_mm[None, None, :]
    )
    return pts.astype(np.float32)
