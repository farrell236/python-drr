#!/usr/bin/env python3
"""Benchmark the available PyDRR rendering backends.

Example:

    python benchmarks/benchmark_backends.py input.nii.gz \
        --backends cpu cpu-mp mps \
        --repeats 3 \
        --json benchmark-results.json
"""

from __future__ import annotations

import argparse
import json
import platform
import statistics
import sys
import time
from pathlib import Path
from typing import Any

from pydrr import (
    backend_statuses,
    generate_drr,
    load_volume_sitk,
    make_orbit_pose,
    print_geometry_debug,
    print_projection_stats,
    print_volume_debug,
    save_png,
    volume_center_world_xyz,
)


BACKEND_CHOICES = ("cpu", "cpu-mp", "cuda", "mps")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark installed PyDRR backends")
    parser.add_argument("volume", help="Input CT/CBCT volume readable by SimpleITK")
    parser.add_argument("--backends", nargs="+", choices=BACKEND_CHOICES, default=list(BACKEND_CHOICES))
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--warmups", type=int, default=1, help="Warm-up renders for GPU backends")
    parser.add_argument("--cpu-workers", type=int, default=8)
    parser.add_argument("--angle", type=float, default=30.0)
    parser.add_argument("--sid-mm", type=float, default=1000.0)
    parser.add_argument("--idd-mm", type=float, default=500.0)
    parser.add_argument("--detector-size", nargs=2, type=int, metavar=("HEIGHT", "WIDTH"), default=(512, 512))
    parser.add_argument("--detector-spacing", nargs=2, type=float, metavar=("ROW_MM", "COL_MM"), default=(0.51, 0.51))
    parser.add_argument("--threshold", type=float, default=-900.0)
    parser.add_argument("--json", type=Path, help="Write machine-readable results")
    parser.add_argument("--save-images", type=Path, help="Directory for rendered PNGs")
    return parser.parse_args()


def synchronize(backend: str) -> None:
    if backend == "mps":
        import torch

        torch.mps.synchronize()
    elif backend == "cuda":
        import cupy

        cupy.cuda.Stream.null.synchronize()


def benchmark(
    name: str,
    backend: str,
    volume,
    geometry,
    projector_kwargs: dict[str, Any],
    repeats: int,
    warmups: int,
    cpu_workers: int,
) -> tuple[dict[str, Any], Any]:
    workers = cpu_workers if name == "cpu-mp" else None
    gpu_warmups = warmups if backend in {"cuda", "mps"} else 0
    for _ in range(gpu_warmups):
        generate_drr(
            volume,
            geometry,
            backend=backend,
            n_cores=workers,
            show_progress=False,
            projector_kwargs=projector_kwargs,
        )
        synchronize(backend)

    durations: list[float] = []
    projection = None
    for index in range(repeats):
        synchronize(backend)
        started = time.perf_counter()
        projection = generate_drr(
            volume,
            geometry,
            backend=backend,
            n_cores=workers,
            show_progress=False,
            projector_kwargs=projector_kwargs,
        )
        synchronize(backend)
        duration = time.perf_counter() - started
        durations.append(duration)
        print(f"[{name}] {index + 1}/{repeats}: {duration:.3f} s")

    assert projection is not None
    return (
        {
            "name": name,
            "backend": backend,
            "cpu_workers": workers,
            "durations_s": durations,
            "mean_s": statistics.mean(durations),
            "min_s": min(durations),
            "max_s": max(durations),
        },
        projection,
    )


def main() -> int:
    args = parse_args()
    if args.repeats < 1 or args.warmups < 0 or args.cpu_workers < 1:
        raise SystemExit("repeats and cpu-workers must be positive; warmups cannot be negative")

    statuses = {status.id: status for status in backend_statuses()}
    runnable: list[tuple[str, str]] = []
    for requested in dict.fromkeys(args.backends):
        backend = "cpu" if requested == "cpu-mp" else requested
        if statuses[backend].available:
            runnable.append((requested, backend))
        else:
            print(f"Skipping {requested}: {statuses[backend].detail}")
    if not runnable:
        raise SystemExit("None of the requested backends are available")

    volume = load_volume_sitk(args.volume)
    isocenter = volume_center_world_xyz(volume)
    geometry = make_orbit_pose(
        iso_center_mm=isocenter,
        projection_angle_deg=args.angle,
        sid_mm=args.sid_mm,
        idd_mm=args.idd_mm,
        detector_size_px=tuple(args.detector_size),
        detector_spacing_mm=tuple(args.detector_spacing),
    )
    print_volume_debug(volume)
    print_geometry_debug(geometry, isocenter)

    projector_kwargs = {
        "hu_air_threshold": args.threshold,
        "clamp_negative_to_zero": True,
    }
    results: list[dict[str, Any]] = []
    for name, backend in runnable:
        result, projection = benchmark(
            name,
            backend,
            volume,
            geometry,
            projector_kwargs,
            args.repeats,
            args.warmups,
            args.cpu_workers,
        )
        print_projection_stats(projection, name)
        results.append(result)
        if args.save_images:
            args.save_images.mkdir(parents=True, exist_ok=True)
            save_png(str(args.save_images / f"{name}.png"), projection, invert=True)

    baseline = results[0]["mean_s"]
    for result in results:
        result["speedup_vs_first"] = baseline / result["mean_s"]
        print(
            f"{result['name']:<8} mean={result['mean_s']:.3f}s "
            f"speedup={result['speedup_vs_first']:.2f}x"
        )

    payload = {
        "runtime": {
            "python": sys.version.split()[0],
            "executable": sys.executable,
            "platform": platform.platform(),
            "architecture": platform.machine(),
        },
        "volume": str(Path(args.volume).resolve()),
        "detector_size": args.detector_size,
        "detector_spacing": args.detector_spacing,
        "results": results,
    }
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
