#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .geometry import DRRGeometry, make_detector_basis_from_forward, make_orbit_pose
from .renderer import generate_drr
from .visualization import print_geometry_debug, print_projection_stats, print_volume_debug, save_png
from .volume import load_volume_sitk, voxel_zyx_to_world_xyz


def parse_args(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    argv = ["--detector-center-px" if value == "-2dcx" else value for value in argv]
    p = argparse.ArgumentParser(
        description="Calculate a Digitally Reconstructed Radiograph from a CT/CBCT image using a Siddon/Jacobs-style ray-tracing projector."
    )
    p.add_argument("input", type=str, help="Input 3D image filename readable by SimpleITK")
    p.add_argument("-v", "--verbose", action="store_true", help="Verbose output (default: False)")
    p.add_argument("-res", nargs=2, type=float, metavar=("ROW_MM", "COL_MM"), default=(0.51, 0.51),
                   help="DRR pixel spacing in the isocenter plane in mm (default: %(default)s)")
    p.add_argument("-size", nargs=2, type=int, metavar=("H", "W"), default=(512, 512),
                   help="DRR size in pixels (default: %(default)s)")
    p.add_argument("-scd", type=float, default=1000.0,
                   help="Source to isocenter distance in mm (default: %(default)s)")
    p.add_argument("--idd", type=float, default=None,
                   help="Isocenter to detector distance in mm. Defaults to the source-to-isocenter distance.")
    p.add_argument("-t", "--isocenter-offset-mm", nargs=3, type=float, metavar=("TX", "TY", "TZ"), default=(0.0, 0.0, 0.0),
                   help="Isocenter offset along fixed physical world x, y, z axes in mm (default: %(default)s)")
    p.add_argument("--orbit-tilt-x", type=float, default=0.0,
                   help="Orbit-plane tilt about the fixed physical world X axis in degrees (default: %(default)s)")
    p.add_argument("--orbit-tilt-y", type=float, default=0.0,
                   help="Orbit-plane tilt about the fixed physical world Y axis in degrees (default: %(default)s)")
    p.add_argument("--detector-roll", type=float, default=0.0,
                   help="Detector in-plane roll about the source-to-detector ray in degrees (default: %(default)s)")
    p.add_argument("-rx", dest="legacy_rx", type=float, default=None, help=argparse.SUPPRESS)
    p.add_argument("-ry", dest="legacy_ry", type=float, default=None, help=argparse.SUPPRESS)
    p.add_argument("-rz", dest="legacy_rz", type=float, default=None, help=argparse.SUPPRESS)
    p.add_argument("--detector-center-px", nargs=2, type=float, metavar=("COL", "ROW"), default=None,
                   help="Central axis detector position in continuous pixel indices (col row) (default: None)")
    p.add_argument("--detector-offset-mm", nargs=2, type=float, metavar=("U_MM", "V_MM"), default=(0.0, 0.0),
                   help="Detector-center offset along its u and v axes in mm (default: %(default)s)")
    p.add_argument("-iso", nargs=3, type=float, metavar=("IX", "IY", "IZ"), default=None,
                   help="CT isocenter in continuous voxel indices (x y z) (default: None)")
    p.add_argument("-rp", "--projection-angle", dest="projection_angle_deg", type=float, default=0.0,
                   help="Source position angle within the configured orbit plane in degrees (default: %(default)s)")
    p.add_argument("-threshold", "--threshold", type=float, default=0.0,
                   help="Ignore CT values below this threshold (default: %(default)s)")
    p.add_argument("-o", "--output", required=True, type=str,
                   help="Output image filename (default: None)")
    p.add_argument("--invert", action="store_true",
                   help="Invert grayscale when saving display-oriented formats like PNG (default: False)")
    p.add_argument("--no-clamp-negative", action="store_true",
                   help="Do not clamp negative intensities to zero above the threshold (default: False)")
    p.add_argument("--p-lo", type=float, default=1.0,
                   help="Lower percentile for PNG-style normalization (default: %(default)s)")
    p.add_argument("--p-hi", type=float, default=99.5,
                   help="Upper percentile for PNG-style normalization (default: %(default)s)")
    p.add_argument("--n-cores", type=int, default=None,
                   help="Number of CPU cores/processes for parallel rendering. Omit for serial rendering. (default: None)")
    p.add_argument("--mp-chunksize", type=int, default=1,
                   help="Row chunksize for multiprocessing work scheduling. (default: %(default)s)")
    p.add_argument("--backend", choices=["auto", "cpu", "cuda", "mps"], default="cpu",
                   help="Rendering backend. 'auto' selects CUDA, then Apple MPS, then CPU. (default: %(default)s)")
    return p.parse_args(argv)


def _legacy_rotation_matrix_xyz(rx_deg: float, ry_deg: float, rz_deg: float):
    import numpy as np

    rx = np.deg2rad(rx_deg)
    ry = np.deg2rad(ry_deg)
    rz = np.deg2rad(rz_deg)

    cx, sx = np.cos(rx), np.sin(rx)
    cy, sy = np.cos(ry), np.sin(ry)
    cz, sz = np.cos(rz), np.sin(rz)

    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], dtype=np.float32)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], dtype=np.float32)
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], dtype=np.float32)
    return Rz @ Ry @ Rx


def build_geometry(vol, args):
    import numpy as np

    if args.iso is None:
        shape_zyx = vol.data.shape
        center_zyx = ((np.array(shape_zyx, dtype=np.float32) - 1.0) / 2.0)
        iso_center_mm = voxel_zyx_to_world_xyz(
            center_zyx[None], vol.spacing_zyx, vol.origin_zyx, vol.direction
        )[0]
    else:
        ix, iy, iz = map(float, args.iso)
        center_zyx = np.array([iz, iy, ix], dtype=np.float32)
        iso_center_mm = voxel_zyx_to_world_xyz(
            center_zyx[None], vol.spacing_zyx, vol.origin_zyx, vol.direction
        )[0]

    iso_center_mm = iso_center_mm + np.array(args.isocenter_offset_mm, dtype=np.float32)

    H, W = map(int, args.size)
    row_spacing, col_spacing = map(float, args.res)
    offset_u_mm, offset_v_mm = map(float, args.detector_offset_mm)
    cx_arg = args.detector_center_px
    if cx_arg is not None:
        col_idx, row_idx = map(float, cx_arg)
        offset_u_mm += (col_idx - (W - 1) / 2.0) * col_spacing
        offset_v_mm += (row_idx - (H - 1) / 2.0) * row_spacing

    idd_mm = args.scd if args.idd is None else float(args.idd)
    legacy_values = (args.legacy_rx, args.legacy_ry, args.legacy_rz)
    using_legacy_rotation = any(value is not None for value in legacy_values)
    if not using_legacy_rotation:
        return make_orbit_pose(
            iso_center_mm=iso_center_mm,
            projection_angle_deg=args.projection_angle_deg,
            sid_mm=args.scd,
            idd_mm=idd_mm,
            orbit_tilt_x_deg=args.orbit_tilt_x,
            orbit_tilt_y_deg=args.orbit_tilt_y,
            detector_roll_deg=args.detector_roll,
            detector_offset_u_mm=offset_u_mm,
            detector_offset_v_mm=offset_v_mm,
            detector_size_px=(H, W),
            detector_spacing_mm=(row_spacing, col_spacing),
        ), iso_center_mm.astype(np.float32)

    if args.orbit_tilt_x != 0.0 or args.orbit_tilt_y != 0.0 or args.detector_roll != 0.0:
        raise ValueError("Legacy -rx/-ry/-rz cannot be combined with the new orbit tilt or detector roll options")
    print(
        "Warning: -rx/-ry/-rz use PyDRR's deprecated legacy acquisition rotation. "
        "Use --orbit-tilt-x, --orbit-tilt-y, and --detector-roll for new commands.",
        file=sys.stderr,
    )

    theta = np.deg2rad(float(args.projection_angle_deg))
    source_offset = np.array([
        args.scd * np.cos(theta),
        args.scd * np.sin(theta),
        0.0,
    ], dtype=np.float32)

    source_norm = float(np.linalg.norm(source_offset))
    if source_norm <= 0.0:
        raise ValueError("Source-to-isocenter distance must be greater than zero")
    if idd_mm < 0.0:
        raise ValueError("Isocenter-to-detector distance cannot be negative")
    detector_offset = -(source_offset / source_norm) * idd_mm

    legacy_rx, legacy_ry, legacy_rz = (0.0 if value is None else value for value in legacy_values)
    R = _legacy_rotation_matrix_xyz(legacy_rx, legacy_ry, legacy_rz)
    source_offset = (R @ source_offset.reshape(3, 1)).ravel()
    detector_offset = (R @ detector_offset.reshape(3, 1)).ravel()

    source_mm = iso_center_mm + source_offset
    detector_center_mm = iso_center_mm + detector_offset

    forward = detector_center_mm - source_mm
    detector_u_mm, detector_v_mm = make_detector_basis_from_forward(forward)

    detector_center_mm = (
        detector_center_mm
        + offset_u_mm * detector_u_mm
        + offset_v_mm * detector_v_mm
    )

    return DRRGeometry(
        source_mm=source_mm.astype(np.float32),
        detector_center_mm=detector_center_mm.astype(np.float32),
        detector_u_mm=detector_u_mm.astype(np.float32),
        detector_v_mm=detector_v_mm.astype(np.float32),
        detector_size_px=(H, W),
        detector_spacing_mm=(row_spacing, col_spacing),
    ), iso_center_mm.astype(np.float32)


def main(argv=None) -> int:
    args = parse_args(argv)
    vol = load_volume_sitk(args.input)

    geom, iso_center_mm = build_geometry(vol, args)

    if args.verbose:
        print_volume_debug(vol)
        print_geometry_debug(geom, iso_center_mm=iso_center_mm)

    drr = generate_drr(
        vol=vol,
        geom=geom,
        projector_kwargs={
            "hu_air_threshold": args.threshold,
            "clamp_negative_to_zero": not args.no_clamp_negative,
        },
        n_cores=args.n_cores,
        mp_chunksize=args.mp_chunksize,
        backend=args.backend,
        show_progress=True,
    )

    if args.verbose:
        print_projection_stats(drr, "DRR")

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    save_png(str(output_path), drr, invert=args.invert, p_lo=args.p_lo, p_hi=args.p_hi)
    print(f"Saved {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
