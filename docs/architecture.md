# Architecture

PyDRR is split into a reusable rendering library and an optional local browser
application. The installable distribution is named `python-drr`; the import
package and core command remain `pydrr`.

```text
local browser <----------> local pydrr_studio API
                                |
                                v
                     isolated Python worker
                                |
                                v
                              pydrr

local CLI -------------------> pydrr
Python applications ---------> pydrr
```

## `pydrr`

The core package owns volume I/O, physical geometry, projection algorithms,
backend discovery, image normalization, and the command-line interface. Its
required dependencies include the CPU renderer and the accelerator runtime
applicable to the current platform. It does not import FastAPI or contain
browser and job-management concepts.

Rendering backends live under `pydrr.backends`:

- `cpu.py` contains the reference Siddon/Jacobs projector.
- `cuda.py` contains the CuPy CUDA kernel.
- `mps.py` contains the PyTorch Apple Metal projector.
- `registry.py` reports availability and resolves `auto` selections.

`attenuation.py` defines the shared projection-model contract. The CPU, CUDA,
and MPS projectors implement both the legacy raw CT-value sum and the same
water-relative HU conversion, so changing compute devices does not change the
meaning of an acquisition.

## `pydrr_studio`

The `studio` installation extra adds FastAPI, Uvicorn, and multipart upload
support. The Studio package owns the loopback API, local uploads, background
jobs, windowed multiplanar slice responses, result archives, and runtime
diagnostics. It depends on `pydrr` for all geometry, backend discovery, and
rendering behavior. Viewer crosshairs are converted between voxel ZYX and
physical world XYZ coordinates with the uploaded volume's spacing, origin, and
direction matrix; the resulting world offset is passed directly to the core
acquisition geometry. The API also provides nearest-voxel intensity samples for
the Viewer crosshair. Studio classifies physical geometry before rendering and
blocks acquisition for invalid spacing, singular matrices, or non-orthonormal
directions while keeping inspectable volumes available in the Viewer. Viewer volume-rendering state is owned by the application
so its slice planes, transfer-function preset, shift, and opacity remain
consistent in the Acquire and Batch geometry scenes.

The React/vtk.js source is maintained in `apps/studio/frontend`. Its production
build is generated under `pydrr_studio/static` and included in Python wheels.
`pydrr-studio` starts the loopback service, serves that build, and opens it in
the user's browser. The frontend and API therefore share one local origin;
there is no hosted frontend or public-to-loopback connection.

Render and batch jobs run in external subprocesses for cancellation and failure
isolation. Each worker uses the same Python executable that launched Studio, so
the CLI, Python API, and Studio see the same installed backends. Studio never
changes Python environments or installs dependencies.
The worker stores the complete submitted settings in result metadata; the
frontend uses that immutable snapshot for preview orientation, captions, and
stale-result detection.

The core package must never import `pydrr_studio`.
