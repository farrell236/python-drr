# PyDRR Studio

PyDRR Studio is the browser interface for configuring single DRR acquisitions
and batch angle sweeps. GitHub Pages hosts the static React/vtk.js frontend.
The `pydrr_studio` package runs the API and render workers on the user's own
computer.

## Install and run

From the repository root:

```bash
python -m pip install ".[studio,mps]"
pydrr-studio
```

Until `python-drr` is published on PyPI, a user without a checkout can install
it directly from GitHub:

```bash
python -m pip install "python-drr[studio] @ git+https://github.com/farrell236/python-drr.git"
```

The distribution is named `python-drr`; its Python import and command-line
entry point remain `pydrr`.

Open `https://farrell236.github.io/python-drr/` and connect to
`http://127.0.0.1:8765`. The local URL also serves a bundled copy of the
frontend for offline use. The service binds to loopback by default and accepts
browser requests only from the official Pages origin and local development
origins. Uploaded medical images and generated projections stay local.

Some browsers ask for local-network permission when a public HTTPS page first
contacts a loopback service. Allow that request for Studio to connect.

The Performance panel reports the exact Python executable and packages used by
render workers. Choose a discovered interpreter or enter the executable path
for a virtual environment, then select **Use Python**. Studio probes that
environment in a clean subprocess and marks devices that still need packages.
Selecting one of those devices keeps rendering disabled until installation
finishes.
**Install packages** invokes that interpreter's `pip` for the core rendering
dependencies and adds PyTorch for MPS or CuPy for CUDA when requested.

Projection and batch jobs run in a subprocess launched by the selected Python;
the web server does not need to restart when the selection changes. Automatic
device selection prefers CUDA, then Apple Silicon MPS, then CPU. Installation
is the only Studio action that downloads software.

## Frontend development

Install an editable Python package and the frontend dependencies, then run the
API and Vite development server separately:

```bash
python -m pip install -e ".[studio,mps,test]"
pnpm --dir apps/studio/frontend install
pydrr-studio --reload
pnpm --dir apps/studio/frontend dev
```

Vite serves the frontend on `http://127.0.0.1:5173` and proxies `/api` to the
backend on port 8765.

## Production frontend assets

`pnpm build` writes the frontend into `src/pydrr_studio/static`. The directory
is committed so a source checkout can build a working Python package without
requiring Node.js. Python package builds include these files in the wheel.
Rebuild and commit the directory whenever the frontend source changes.

## GitHub Pages deployment

`.github/workflows/pages.yml` builds and deploys the frontend on every push to
`main`. In the repository settings, set **Pages → Build and deployment →
Source** to **GitHub Actions**. Vite uses relative asset URLs, so the build
works beneath a project path such as `/python-drr/`.

Uploaded volumes and generated results are kept in a temporary local session
directory. Download a result archive to retain its PNG, NumPy data, and JSON
geometry metadata.
