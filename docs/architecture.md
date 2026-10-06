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

## `pydrr_studio`

The `studio` installation extra adds FastAPI, Uvicorn, and multipart upload
support. The Studio package owns the loopback API, local uploads, background
jobs, result archives, and runtime diagnostics. It depends on `pydrr` for all
geometry, backend discovery, and rendering behavior.

The React/vtk.js source is maintained in `apps/studio/frontend`. Its production
build is generated under `pydrr_studio/static` and included in Python wheels.
`pydrr-studio` starts the loopback service, serves that build, and opens it in
the user's browser. The frontend and API therefore share one local origin;
there is no hosted frontend or public-to-loopback connection.

Render and batch jobs run in external subprocesses for cancellation and failure
isolation. Each worker uses the same Python executable that launched Studio, so
the CLI, Python API, and Studio see the same installed backends. Studio never
changes Python environments or installs dependencies.

The core package must never import `pydrr_studio`.
