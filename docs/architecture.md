# Architecture

PyDRR is split into a reusable rendering library and optional applications.

```text
GitHub Pages (static React Studio)
               |
               | browser requests to http://127.0.0.1:8765
               v
local pydrr_studio API -> selected Python worker -> pydrr
local CLI ------------------------------------------> pydrr
Python applications -------------------------------> pydrr
```

## `pydrr`

The core package owns volume I/O, physical geometry, projection algorithms,
backend discovery, image normalization, and the command-line interface. It
does not import FastAPI or contain browser and job-management concepts.

Rendering backends live under `pydrr.backends`:

- `cpu.py` contains the reference Siddon/Jacobs projector.
- `cuda.py` contains the optional CuPy CUDA kernel.
- `mps.py` contains the optional PyTorch Apple Metal projector.
- `registry.py` reports availability and resolves `auto` selections.

## `pydrr_studio`

The Studio package owns the loopback API, local uploads, background jobs,
result archives, runtime diagnostics, and Python environment management. It
depends on `pydrr`. Render and batch jobs run in an external worker launched by
the Python executable selected in the Performance panel. Studio probes and
installs dependencies with that same interpreter, so device availability and
job execution use one environment.

The React/vtk.js source is maintained separately in `apps/studio/frontend`.
GitHub Pages serves its static build. The same build is generated under
`pydrr_studio/static` and included in Python wheels as a local/offline fallback.
The browser sends data directly to the loopback API; the static host never
handles NIfTI files or rendering results. The API permits the official GitHub
Pages origin and local development origins only.

The core package must never import `pydrr_studio`.
