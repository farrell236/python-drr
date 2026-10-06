"""Minimal PyDRR library example.

Run after installing the repository:

    python examples/single_projection.py input.nii.gz projection.png
"""

from __future__ import annotations

import argparse

from pydrr import (
    generate_drr,
    load_volume_sitk,
    make_orbit_pose,
    save_png,
    volume_center_world_xyz,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render one DRR with the PyDRR library")
    parser.add_argument("input", help="Input volume readable by SimpleITK")
    parser.add_argument("output", help="Output PNG path")
    parser.add_argument("--angle", type=float, default=0.0)
    parser.add_argument("--backend", choices=["auto", "cpu", "cuda", "mps"], default="auto")
    args = parser.parse_args()

    volume = load_volume_sitk(args.input)
    geometry = make_orbit_pose(
        iso_center_mm=volume_center_world_xyz(volume),
        projection_angle_deg=args.angle,
        detector_size_px=(512, 512),
        detector_spacing_mm=(0.51, 0.51),
    )
    projection = generate_drr(
        volume,
        geometry,
        backend=args.backend,
        projector_kwargs={"hu_air_threshold": -900.0, "clamp_negative_to_zero": True},
    )
    save_png(args.output, projection, invert=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
