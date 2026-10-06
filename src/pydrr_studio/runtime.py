from __future__ import annotations

import importlib.metadata as metadata
import os
import platform
import subprocess
import sys
from pathlib import Path

from pydrr.backends import backend_statuses, resolve_backend

from .models import BackendInfo, PackageInfo, RuntimeInfo


PACKAGE_DEFINITIONS = (
    ("NumPy", "numpy", True),
    ("SimpleITK", "SimpleITK", True),
    ("SciPy", "scipy", True),
    ("tqdm", "tqdm", True),
    ("ImageIO", "imageio", True),
    ("PyTorch", "torch", False),
    ("CuPy", "cupy", False),
)


def _package_info() -> list[PackageInfo]:
    packages: list[PackageInfo] = []
    for name, distribution, required in PACKAGE_DEFINITIONS:
        try:
            version = metadata.version(distribution)
        except metadata.PackageNotFoundError:
            version = None
        packages.append(PackageInfo(
            name=name,
            distribution=distribution,
            installed=version is not None,
            version=version,
            required=required,
        ))
    return packages


def _clean_environment(python_executable: Path) -> dict[str, str]:
    environment = dict(os.environ)
    for name in ("PYTHONHOME", "PYTHONPATH", "__PYVENV_LAUNCHER__"):
        environment.pop(name, None)
    environment["PYTHONUNBUFFERED"] = "1"
    if sys.platform == "darwin" and (python_executable.parent.parent / "pyvenv.cfg").is_file():
        environment["__PYVENV_LAUNCHER__"] = str(python_executable)
    return environment


class RuntimeManager:
    @property
    def python_executable(self) -> Path:
        return Path(os.path.abspath(sys.executable))

    def info(self, refresh: bool = False) -> RuntimeInfo:
        del refresh
        packages = _package_info()
        missing = [item.name for item in packages if item.required and not item.installed]
        statuses = backend_statuses()
        return RuntimeInfo(
            python_executable=str(self.python_executable),
            python_version=platform.python_version(),
            architecture=platform.machine().lower(),
            platform=platform.platform(),
            ready=not missing,
            status="Runtime ready" if not missing else "Missing required packages: " + ", ".join(missing),
            resolved_backend=resolve_backend("auto"),
            backends=[
                BackendInfo(
                    id=status.id,
                    label=status.label,
                    available=status.available,
                    detail=status.detail,
                    package=status.package,
                    version=status.version,
                )
                for status in statuses
            ],
            packages=packages,
        )

    def ensure_backend(self, requested: str) -> tuple[Path, str]:
        return self.python_executable, resolve_backend(requested)

    def launch_worker(self, python_executable: Path, job_path: Path, log_path: Path):
        log_stream = log_path.open("w", encoding="utf-8")
        try:
            process = subprocess.Popen(
                [str(python_executable), "-m", "pydrr_studio.worker", "--job", str(job_path)],
                stdout=log_stream,
                stderr=subprocess.STDOUT,
                text=True,
                env=_clean_environment(python_executable),
            )
        except Exception:
            log_stream.close()
            raise
        return process, log_stream

    def close(self) -> None:
        pass


runtime_manager = RuntimeManager()


def inspect_runtime() -> RuntimeInfo:
    return runtime_manager.info()
