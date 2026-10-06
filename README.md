# PyDRR

PyDRR renders digitally reconstructed radiographs from CT and CBCT volumes
using a Siddon/Jacobs-style projector.

<p align="center">
  <img src="docs/assets/drr_orbit_00.png" width="18%" />
  <img src="docs/assets/drr_orbit_06.png" width="18%" />
  <img src="docs/assets/drr_single.png" width="18%" />
  <img src="docs/assets/orbit_z_rotation.gif" width="18%" />
</p>

## Install

From a cloned repository:

```bash
python -m pip install .
```

Optional backends and applications are installed as extras:

```bash
# Apple Silicon GPU
python -m pip install ".[mps]"

# NVIDIA CUDA
python -m pip install ".[cuda]"

# Local web application
python -m pip install ".[studio]"

# Editable development installation
python -m pip install -e ".[studio,mps,test]"
```

## Command line

Installation provides the `pydrr` command:

```bash
pydrr input.nii.gz \
  --projection-angle 45 \
  --orbit-tilt-x 20 \
  --orbit-tilt-y -10 \
  --detector-roll 5 \
  --backend auto \
  --invert \
  --output projection.png
```

The explicit module form uses a chosen interpreter:

```bash
python -m pydrr --help
```

Available backends are `auto`, `cpu`, `cuda`, and `mps`. Automatic selection
prefers CUDA, then Apple Metal, then CPU. CPU multiprocessing uses
`--n-cores`.

## Python API

```python
from pydrr import generate_drr, load_volume_sitk, make_orbit_pose

volume = load_volume_sitk("input.nii.gz")
geometry = make_orbit_pose(
    iso_center_mm=[0.0, 0.0, 0.0],
    projection_angle_deg=45.0,
)
projection = generate_drr(volume, geometry, backend="auto")
```

See `examples/single_projection.py` for a complete example.

## Geometry convention

PyDRR uses a patient-fixed orbit frame. Projection angle selects the source
position within that frame, X/Y tilts orient the orbit plane in physical world
coordinates, and detector roll rotates the panel around the central ray.
SimpleITK direction matrices are applied during world/voxel conversion and ray
tracing.

The former `-rp` argument remains an alias for `--projection-angle`. Legacy
`-rx`, `-ry`, and `-rz` arguments retain their earlier acquisition-rotation
behavior and emit a deprecation warning.

## Studio

PyDRR Studio separates its public interface from its local compute service.
Install and start PyDRR on the machine that will perform the rendering:

```bash
python -m pip install ".[studio,mps]"
pydrr-studio --port 8765
```

Then open the hosted Studio at `https://farrell236.github.io/python-drr/` and connect
it to `http://127.0.0.1:8765`. The service also serves the same interface at
that local address as an offline fallback. NIfTI volumes and generated results
travel directly between the browser and the loopback service; GitHub Pages
does not receive them. A browser may ask for permission to access the local
network the first time it connects.

The installable distribution is named `python-drr`; the Python import and CLI
remain `pydrr`. See `apps/studio/README.md` for deployment and development
instructions.

The Performance panel can probe another Python executable, install the core
rendering packages and the selected accelerator package with that
interpreter's `pip`, and use it for subsequent projection and batch workers.
The local FastAPI service remains in its original environment while compute
jobs run in the selected environment.

## Repository layout

- `src/pydrr`: reusable rendering package and CLI
- `src/pydrr_studio`: optional local API and job service
- `apps/studio/frontend`: React/vtk.js frontend
- `tests`: core and Studio tests
- `examples`: small library examples
- `benchmarks`: backend benchmark tooling and historical results
- `docs`: architecture and documentation assets

## Acknowledgement

ChatGPT and Codex were used to assist with coding, debugging, and documentation.
