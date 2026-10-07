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

## Workspaces

- **Viewer** uses a Slicer-style 2 × 2 layout with linked axial, coronal, and
  sagittal slices plus an orbitable 3D context. The 3D view can show the active
  textured slice planes or a GPU-rendered bone, soft-tissue, or skin preset.
  Each rendering preset remembers its independent intensity shift and opacity,
  while CT window controls remain specific to the three slice views. Rendering
  data is loaded lazily as a bounded display copy; the original volume remains
  unchanged for projection generation. Physical orientation labels, slice
  navigation, zoom, and reset controls are included. The four views form
  one continuous 2 × 2 surface with compact in-image labels, including on
  narrow displays. Clicking or dragging within a slice moves the shared
  crosshair through the other two views while the dragged image stays fixed.
- **Acquire** configures and renders a single projection from that isocenter.
  Its geometry view carries over the active slice planes or volume preset,
  including the current intensity shift and opacity.
- **Batch** previews and executes an angle sweep with the active geometry and
  the same patient rendering selected in Viewer.
- **Results** lists completed projections and downloadable archives from the
  current local session.
- **Settings** stores application-wide appearance and compute defaults in the
  browser. It also reports the Python executable, detected compute devices,
  and installed core and accelerator packages used by the local server.

The Viewer converts between voxel indices and physical world coordinates using
the NIfTI spacing, origin, and direction matrix. Its isocenter therefore uses
the same coordinate convention as the core projector.

## Compute environment

Studio uses the Python environment that launches `pydrr-studio`. Its
Performance panel reports that executable and the CPU, CUDA, and MPS devices
detected by the core package. Automatic selection prefers CUDA, then Apple
Silicon MPS, then CPU. Users can explicitly select any available backend, so a
machine with CUDA can still run a CPU acquisition. The preferred backend and
CPU worker count can be saved in Settings; individual acquisitions can still
override those defaults.

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
