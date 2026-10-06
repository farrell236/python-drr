from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path

import pydrr

from .models import PythonCandidate, RuntimeInfo, RuntimeInstallInfo


WORKER_REQUIREMENTS = (
    "numpy>=2.0",
    "SimpleITK>=2.4",
    "scipy>=1.13",
    "tqdm>=4.66",
    "imageio>=2.35",
    "pydantic>=2",
)

PROBE_SCRIPT = r'''
import importlib.metadata as metadata
import json
import os
import platform
import sys

packages = []
definitions = (
    ("NumPy", "numpy", True),
    ("SimpleITK", "SimpleITK", True),
    ("SciPy", "scipy", True),
    ("tqdm", "tqdm", True),
    ("ImageIO", "imageio", True),
    ("Pydantic", "pydantic", True),
    ("PyTorch", "torch", False),
    ("CuPy", "cupy", False),
)
versions = {}
for label, distribution, required in definitions:
    try:
        version = metadata.version(distribution)
    except metadata.PackageNotFoundError:
        version = None
    versions[distribution] = version
    packages.append({
        "name": label,
        "distribution": distribution,
        "installed": version is not None,
        "version": version,
        "required": required,
    })

architecture = platform.machine().lower()
is_macos = sys.platform == "darwin"
mps_available = False
if versions.get("torch"):
    try:
        import torch
        mps = getattr(torch.backends, "mps", None)
        mps_available = bool(mps and mps.is_available())
    except Exception:
        pass

cuda_available = False
cuda_detail = "Install a CUDA-compatible CuPy build to enable this backend."
if is_macos:
    cuda_detail = "CUDA is not supported on macOS."
elif versions.get("cupy"):
    try:
        import cupy
        count = int(cupy.cuda.runtime.getDeviceCount())
        cuda_available = count > 0
        cuda_detail = (
            f"Ready with {count} CUDA device{'s' if count != 1 else ''}."
            if count else "CuPy is installed, but no CUDA device was found."
        )
    except Exception as exc:
        cuda_detail = f"CuPy is installed, but CUDA is unavailable: {exc}"

if mps_available:
    mps_detail = "Ready through PyTorch Metal Performance Shaders."
elif not is_macos or architecture not in {"arm64", "arm64e"}:
    mps_detail = "MPS requires an Apple Silicon Mac."
elif versions.get("torch"):
    mps_detail = "PyTorch is installed, but MPS is unavailable to this interpreter."
else:
    mps_detail = "Install PyTorch in this Python environment to enable Apple GPU rendering."

backends = [
    {"id": "cpu", "label": "CPU", "available": True,
     "detail": f"Ready on {architecture or 'this system'}.", "package": None, "version": None},
    {"id": "mps", "label": "Apple GPU (MPS)", "available": mps_available,
     "detail": mps_detail, "package": "torch", "version": versions.get("torch")},
    {"id": "cuda", "label": "NVIDIA GPU (CUDA)", "available": cuda_available,
     "detail": cuda_detail, "package": "cupy", "version": versions.get("cupy")},
]
missing = [item["name"] for item in packages if item["required"] and not item["installed"]]
resolved = "cuda" if cuda_available else "mps" if mps_available else "cpu"
print(json.dumps({
    "python_executable": os.path.abspath(sys.executable),
    "python_version": platform.python_version(),
    "architecture": architecture,
    "platform": platform.platform(),
    "ready": not missing,
    "status": "Runtime ready" if not missing else "Missing required packages: " + ", ".join(missing),
    "resolved_backend": resolved,
    "backends": backends,
    "packages": packages,
}))
'''


@dataclass
class _InstallRecord:
    id: str
    status: str = "queued"
    message: str = "Queued"
    output: str = ""


def _absolute_python(path: str | Path) -> Path:
    return Path(os.path.abspath(os.path.expanduser(str(path))))


def _clean_environment(python_executable: Path, python_path: Path | None = None) -> dict[str, str]:
    environment = dict(os.environ)
    for name in ("PYTHONHOME", "PYTHONPATH", "__PYVENV_LAUNCHER__"):
        environment.pop(name, None)
    if python_path is not None:
        environment["PYTHONPATH"] = str(python_path)
    environment["PYTHONUNBUFFERED"] = "1"
    if sys.platform == "darwin" and (python_executable.parent.parent / "pyvenv.cfg").is_file():
        environment["__PYVENV_LAUNCHER__"] = str(python_executable)
    return environment


class RuntimeManager:
    def __init__(self) -> None:
        self._server_python = _absolute_python(sys.executable)
        self._selected_python = self._server_python
        self._lock = threading.RLock()
        self._cached_info: RuntimeInfo | None = None
        self._install_jobs: dict[str, _InstallRecord] = {}
        self._active_install_id: str | None = None
        self._install_process: subprocess.Popen | None = None
        self._bundle_root: Path | None = None

    @property
    def python_executable(self) -> Path:
        with self._lock:
            return self._selected_python

    def candidates(self) -> list[PythonCandidate]:
        paths: list[tuple[str, Path]] = [
            ("Studio server", self._server_python),
            (
                "Current environment",
                Path(sys.prefix) / ("python.exe" if sys.platform == "win32" else "bin/python"),
            ),
        ]
        for command in ("python3", "python"):
            found = shutil.which(command)
            if found:
                paths.append((f"PATH · {command}", _absolute_python(found)))
        paths.extend((
            ("System Python", Path("/usr/bin/python3")),
            ("Homebrew Python", Path("/opt/homebrew/bin/python3")),
            ("Local Python", Path("/usr/local/bin/python3")),
            ("Selected Python", self.python_executable),
        ))

        seen: set[str] = set()
        result: list[PythonCandidate] = []
        for label, path in paths:
            absolute = _absolute_python(path)
            key = str(absolute)
            if key in seen or not absolute.is_file():
                continue
            seen.add(key)
            result.append(PythonCandidate(
                label=label,
                python_executable=key,
                is_server_python=absolute == self._server_python,
            ))
        return result

    def probe(self, python_executable: str | Path) -> RuntimeInfo:
        python_path = _absolute_python(python_executable)
        if not python_path.is_file():
            raise ValueError(f"Python executable does not exist: {python_path}")
        try:
            completed = subprocess.run(
                [str(python_path), "-c", PROBE_SCRIPT],
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
                env=_clean_environment(python_path),
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError(f"Could not run {python_path}: {exc}") from exc
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip() or "Runtime probe failed"
            raise RuntimeError(detail[-2000:])
        try:
            payload = json.loads(completed.stdout.strip().splitlines()[-1])
        except (IndexError, json.JSONDecodeError) as exc:
            raise RuntimeError("The selected Python returned invalid runtime information") from exc
        payload["python_executable"] = str(python_path)
        payload["server_python_executable"] = str(self._server_python)
        payload["is_server_python"] = python_path == self._server_python
        payload["candidates"] = [candidate.model_dump() for candidate in self.candidates()]
        return RuntimeInfo.model_validate(payload)

    def info(self, refresh: bool = False) -> RuntimeInfo:
        with self._lock:
            cached = self._cached_info
            selected = self._selected_python
        if cached is not None and not refresh:
            return cached
        info = self.probe(selected)
        with self._lock:
            self._cached_info = info
        return info

    def select(self, python_executable: str | Path) -> RuntimeInfo:
        with self._lock:
            if self._active_install_id:
                active = self._install_jobs.get(self._active_install_id)
                if active and active.status in {"queued", "running"}:
                    raise RuntimeError("Wait for the dependency installation to finish before changing Python")
        info = self.probe(python_executable)
        selected = _absolute_python(python_executable)
        with self._lock:
            self._selected_python = selected
        info = info.model_copy(update={"candidates": self.candidates()})
        with self._lock:
            self._cached_info = info
        return info

    def ensure_backend(self, requested: str) -> tuple[Path, str]:
        info = self.info()
        backend = info.resolved_backend if requested == "auto" else requested
        available = {item.id: item for item in info.backends}
        if backend not in available:
            raise ValueError("backend must be 'auto', 'cpu', 'cuda', or 'mps'")
        if not info.ready:
            raise RuntimeError(info.status)
        if not available[backend].available:
            raise RuntimeError(f"{available[backend].label} is unavailable. {available[backend].detail}")
        return self.python_executable, backend

    def start_install(self, requested_backend: str) -> RuntimeInstallInfo:
        with self._lock:
            if self._active_install_id:
                active = self._install_jobs.get(self._active_install_id)
                if active and active.status in {"queued", "running"}:
                    raise RuntimeError("A dependency installation is already running")
            record = _InstallRecord(id=uuid.uuid4().hex)
            self._install_jobs[record.id] = record
            self._active_install_id = record.id
            python_path = self._selected_python
        threading.Thread(
            target=self._run_install,
            args=(record.id, python_path, requested_backend),
            daemon=True,
            name="pydrr-runtime-install",
        ).start()
        return self.install_info(record.id)

    def install_info(self, install_id: str) -> RuntimeInstallInfo:
        with self._lock:
            record = self._install_jobs.get(install_id)
            if record is None:
                raise KeyError(install_id)
            return RuntimeInstallInfo(
                id=record.id,
                status=record.status,
                message=record.message,
                output=record.output,
            )

    def _append_install_output(self, record: _InstallRecord, text: str) -> None:
        with self._lock:
            record.output = (record.output + text)[-20000:]
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            if lines:
                record.message = lines[-1][:240]

    def _run_install(self, install_id: str, python_path: Path, requested_backend: str) -> None:
        with self._lock:
            record = self._install_jobs[install_id]
            record.status = "running"
            record.message = "Preparing pip…"
        try:
            pip_check = subprocess.run(
                [str(python_path), "-m", "pip", "--version"],
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
                env=_clean_environment(python_path),
            )
            if pip_check.returncode != 0:
                ensure = subprocess.run(
                    [str(python_path), "-m", "ensurepip", "--upgrade"],
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=120,
                    env=_clean_environment(python_path),
                )
                self._append_install_output(record, ensure.stdout + ensure.stderr)
                if ensure.returncode != 0:
                    raise RuntimeError("pip is unavailable and could not be enabled for this Python")

            requirements = list(WORKER_REQUIREMENTS)
            info = self.probe(python_path)
            backend = requested_backend
            if backend == "auto" and info.platform.lower().startswith("macos") and info.architecture in {"arm64", "arm64e"}:
                backend = "mps"
            if backend == "mps":
                requirements.append("torch>=2.4")
            elif backend == "cuda":
                requirements.append("cupy-cuda12x")

            process = subprocess.Popen(
                [str(python_path), "-m", "pip", "install",
                 "--disable-pip-version-check", "--upgrade", "--only-binary=:all:", *requirements],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                env=_clean_environment(python_path),
            )
            with self._lock:
                self._install_process = process
            assert process.stdout is not None
            for line in process.stdout:
                self._append_install_output(record, line)
            return_code = process.wait()
            if return_code != 0:
                raise RuntimeError(f"pip exited with status {return_code}")
            if self.python_executable == python_path:
                with self._lock:
                    self._cached_info = None
                validated = self.info(refresh=True)
            else:
                validated = self.probe(python_path)
            target = validated.resolved_backend if requested_backend == "auto" else requested_backend
            backend_info = next(item for item in validated.backends if item.id == target)
            if not validated.ready or not backend_info.available:
                raise RuntimeError(validated.status if not validated.ready else backend_info.detail)
            with self._lock:
                record.status = "completed"
                record.message = f"Dependencies ready in Python {validated.python_version}"
        except Exception as exc:
            with self._lock:
                record.status = "failed"
                record.message = str(exc)
                record.output = (record.output + f"\n{type(exc).__name__}: {exc}\n")[-20000:]
        finally:
            with self._lock:
                self._install_process = None
                if self._active_install_id == install_id:
                    self._active_install_id = None

    def _ensure_worker_bundle(self) -> Path:
        with self._lock:
            if self._bundle_root and self._bundle_root.is_dir():
                return self._bundle_root
            bundle = Path(tempfile.mkdtemp(prefix="pydrr-worker-code-"))
            for source in (Path(pydrr.__file__).resolve().parent, Path(__file__).resolve().parent):
                shutil.copytree(
                    source,
                    bundle / source.name,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "static"),
                )
            self._bundle_root = bundle
            return bundle

    def launch_worker(self, python_executable: Path, job_path: Path, log_path: Path):
        bundle = self._ensure_worker_bundle()
        log_stream = log_path.open("w", encoding="utf-8")
        try:
            process = subprocess.Popen(
                [str(python_executable), "-m", "pydrr_studio.worker", "--job", str(job_path)],
                stdout=log_stream,
                stderr=subprocess.STDOUT,
                text=True,
                env=_clean_environment(python_executable, bundle),
            )
        except Exception:
            log_stream.close()
            raise
        return process, log_stream

    def close(self) -> None:
        with self._lock:
            bundle = self._bundle_root
            self._bundle_root = None
            install_process = self._install_process
            self._install_process = None
        if install_process is not None and install_process.poll() is None:
            install_process.terminate()
        if bundle:
            shutil.rmtree(bundle, ignore_errors=True)


runtime_manager = RuntimeManager()


def inspect_runtime() -> RuntimeInfo:
    return runtime_manager.info()
