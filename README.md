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

Until the distribution is published on PyPI, install the current version
directly from GitHub:

```bash
python -m pip install "python-drr @ git+https://github.com/farrell236/python-drr.git"
```

This installs the Python API, command-line interface, CPU renderer, and the
accelerator runtime for the current platform: PyTorch for Apple Silicon MPS or
CuPy for CUDA on supported Linux and Windows systems. To include Studio:

```bash
python -m pip install "python-drr[studio] @ git+https://github.com/farrell236/python-drr.git"
```

From a cloned repository, install the local checkout instead:

```bash
python -m pip install .
```

The equivalent local installations are:

```bash
# Local Studio service and bundled web application
python -m pip install ".[studio]"

# Editable development installation
python -m pip install -e ".[studio,test]"
```

## Command line

Installation provides the `pydrr` command:

```bash
pydrr input.nii.gz \
  --projection-angle 45 \
  --orbit-tilt-x 20 \
  --orbit-tilt-y -10 \
  --detector-roll 5 \
  --projection-model relative-attenuation \
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

The default `raw` projection model preserves the original qualitative CT-value
sum. `--projection-model relative-attenuation` maps calibrated CT values to
water-relative attenuation with `max(0, 1 + HU/1000)` before integration. This
model is energy independent and does not claim an absolute attenuation
coefficient.

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

See [`examples/single_projection.py`](examples/single_projection.py) for a
complete example.

## Geometry convention

PyDRR uses a patient-fixed orbit frame. Projection angle selects the source
position within that frame, X/Y tilts orient the orbit plane in physical world
coordinates, and detector roll rotates the panel around the central ray.
SimpleITK direction matrices are applied during world/voxel conversion and ray
tracing. Projection arrays follow image coordinates: row zero is the positive
detector V edge (the physical top), and column zero is the negative detector U
edge (the physical left).

The former `-rp` argument remains an alias for `--projection-angle`. Legacy
`-rx`, `-ry`, and `-rz` arguments retain their earlier acquisition-rotation
behavior and emit a deprecation warning.

## Studio

PyDRR Studio is a local browser application. Install the Studio extra and start
it from the Python environment that will perform the rendering:

```bash
python -m pip install ".[studio]"
pydrr-studio
```

The command starts the loopback server and opens `http://127.0.0.1:8765` in the
default browser. Use `pydrr-studio --no-browser` to start the service without
opening a browser. NIfTI volumes and generated results stay on the local
machine.

Studio opens uploaded volumes in a Slicer-style 2 × 2 viewer with linked axial,
coronal, and sagittal views plus an orbitable 3D context. The Viewer provides
physical orientation labels, CT window presets, slice navigation, cursor-aware
zoom, panning, temporary pane maximization, linked crosshair navigation, exact
world/voxel isocenter entry, and a live crosshair HU readout. Dragging within one slice scrolls
the other two views while the active image remains fixed. The 3D view can show
the current images on the active slice planes or render the volume with
adjustable bone, soft-tissue, and skin presets. Volume rendering uses a bounded
display copy and does not alter the source image used for DRR generation. The
linked crosshair is the acquisition isocenter used by the Acquire and Batch
workspaces. Volumes with invalid physical spacing or a non-orthonormal direction
matrix remain viewable, but acquisition is blocked instead of silently using
incorrect geometry. The active slice-plane or volume-rendering appearance, including
manual shift and opacity adjustments, carries into both geometry previews.
Studio Settings provides persistent system/light/dark appearance choices,
compute defaults, and a detailed view of the active Python environment and
available rendering backends.

Acquire provides anatomically correct AP, PA, left-lateral, and right-lateral
presets, detector orientation labels, exact numeric geometry controls, detector
coverage metrics, and warnings for source placement or clipping. Every preview
retains the settings that produced it and is marked stale after controls change.
The preview supports pan, zoom, fit, and cancellation of an active render.
Batch uses the same runtime, geometry, and detector-coverage checks before an
angle sweep can start. Completed sweeps can be inspected as a playable,
scrollable projection sequence in Results. The shared **Download sweep** menu
provides the complete ZIP package, its JSON manifest, a ready-to-run shell
script, and configurable GIF or H.264 MP4 presentation exports. Media exports
support frame ranges, playback direction, frame rate, resolution, and optional
angle/frame overlays; the ZIP remains the authoritative scientific output.

Refreshing the browser while the local server is still running presents an
explicit option to restore the uploaded volume, viewer and acquisition state,
saved views, active jobs, and results. Restarting the server clears this
temporary session. Result manifests include the package version, creation
time, input size, and SHA-256 checksum in addition to the acquisition geometry.

The installable distribution is named `python-drr`; the Python import and CLI
remain `pydrr`. See the [Studio User Guide](docs/studio-user-guide.md) for the
complete workflow and the [Studio README](apps/studio/README.md) for
installation and development instructions.

The Performance panel reports the active Python executable and detected compute
devices. Users can select automatic resolution or explicitly force CPU, CUDA,
or MPS. Projection and batch workers run in isolated subprocesses using the
same Python environment that launched Studio.

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
