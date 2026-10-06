from __future__ import annotations

import platform
import sys
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class BackendStatus:
    id: str
    label: str
    available: bool
    detail: str
    package: str | None = None
    version: str | None = None


def _cuda_status() -> BackendStatus:
    if sys.platform == "darwin":
        return BackendStatus(
            id="cuda",
            label="NVIDIA GPU (CUDA)",
            available=False,
            detail="CUDA is not supported on macOS.",
            package="cupy",
        )
    try:
        import cupy as cp
    except Exception:
        return BackendStatus(
            id="cuda",
            label="NVIDIA GPU (CUDA)",
            available=False,
            detail="Install a CUDA-compatible CuPy build to enable this backend.",
            package="cupy",
        )
    version = str(getattr(cp, "__version__", "")) or None
    try:
        device_count = int(cp.cuda.runtime.getDeviceCount())
    except Exception as exc:
        return BackendStatus(
            id="cuda",
            label="NVIDIA GPU (CUDA)",
            available=False,
            detail=f"CuPy is installed, but CUDA is unavailable: {exc}",
            package="cupy",
            version=version,
        )
    return BackendStatus(
        id="cuda",
        label="NVIDIA GPU (CUDA)",
        available=device_count > 0,
        detail=(
            f"Ready with {device_count} CUDA device{'s' if device_count != 1 else ''}."
            if device_count > 0
            else "CuPy is installed, but no CUDA device was found."
        ),
        package="cupy",
        version=version,
    )


def _mps_status() -> BackendStatus:
    if sys.platform != "darwin" or platform.machine().lower() not in {"arm64", "arm64e"}:
        return BackendStatus(
            id="mps",
            label="Apple GPU (MPS)",
            available=False,
            detail="MPS requires an Apple Silicon Mac.",
            package="torch",
        )
    try:
        import torch
    except Exception:
        return BackendStatus(
            id="mps",
            label="Apple GPU (MPS)",
            available=False,
            detail="Install PyTorch in this Python environment to enable Apple GPU rendering.",
            package="torch",
        )
    version = str(getattr(torch, "__version__", "")) or None
    mps = getattr(torch.backends, "mps", None)
    built = bool(mps and mps.is_built())
    available = bool(mps and mps.is_available())
    if available:
        detail = "Ready through PyTorch Metal Performance Shaders."
    elif built:
        detail = "PyTorch includes MPS support, but it is unavailable to this process."
    else:
        detail = "This PyTorch build does not include MPS support."
    return BackendStatus(
        id="mps",
        label="Apple GPU (MPS)",
        available=available,
        detail=detail,
        package="torch",
        version=version,
    )


@lru_cache(maxsize=1)
def backend_statuses() -> tuple[BackendStatus, ...]:
    return (
        BackendStatus(
            id="cpu",
            label="CPU",
            available=True,
            detail=f"Ready on {platform.machine() or 'this system'}.",
        ),
        _mps_status(),
        _cuda_status(),
    )


def resolve_backend(requested: str) -> str:
    normalized = str(requested or "auto").strip().lower()
    statuses = {status.id: status for status in backend_statuses()}
    if normalized == "auto":
        for candidate in ("cuda", "mps", "cpu"):
            if statuses[candidate].available:
                return candidate
    if normalized not in statuses:
        raise ValueError("backend must be 'auto', 'cpu', 'cuda', or 'mps'")
    status = statuses[normalized]
    if not status.available:
        raise RuntimeError(f"{status.label} is unavailable. {status.detail}")
    return normalized
