# PyDRR Studio

PyDRR Studio is the local browser interface for configuring single DRR
acquisitions and batch angle sweeps. The Python package serves the bundled
React/vtk.js frontend, API, and render workers from the user's own computer.

## Install and run

From the repository root:

```bash
python -m pip install ".[studio]"
pydrr-studio
```

Until `python-drr` is published on PyPI, a user without a checkout can install
it directly from GitHub:

```bash
python -m pip install "python-drr[studio] @ git+https://github.com/farrell236/python-drr.git"
pydrr-studio
```

The server binds to `http://127.0.0.1:8765` and opens that address in the
default browser. Pass `--no-browser` when the service should start without
opening a browser, or `--port PORT` to choose another port. Uploaded medical
images and generated projections stay local.

The distribution is named `python-drr`; its Python import remains `pydrr`, and
the installed commands are `pydrr` and `pydrr-studio`.

## Compute environment

Studio uses the Python environment that launches `pydrr-studio`. Its
Performance panel reports that executable and the CPU, CUDA, and MPS devices
detected by the core package. Automatic selection prefers CUDA, then Apple
Silicon MPS, then CPU. Users can explicitly select any available backend, so a
machine with CUDA can still run a CPU acquisition.

Projection and batch jobs run in subprocesses launched by the same Python
executable. Studio does not select other environments or install packages at
runtime.

## Frontend development

Install an editable Python package and the frontend dependencies, then run the
API and Vite development server separately:

```bash
python -m pip install -e ".[studio,test]"
pnpm --dir apps/studio/frontend install
pydrr-studio --reload --no-browser
pnpm --dir apps/studio/frontend dev
```

Vite serves the frontend on `http://127.0.0.1:5173` and proxies `/api` to the
backend on port 8765.

## Production frontend assets

`pnpm build` writes the frontend into `src/pydrr_studio/static`. The directory
is committed so a source checkout can build a working Python package without
requiring Node.js. Python package builds include these files in the wheel.
Rebuild and commit the directory whenever the frontend source changes.

Uploaded volumes and generated results are kept in a temporary local session
directory. Download a result archive to retain its PNG, NumPy data, and JSON
geometry metadata.
