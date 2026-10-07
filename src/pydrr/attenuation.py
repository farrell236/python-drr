from __future__ import annotations

from typing import Literal


ProjectionModel = Literal["raw", "relative_attenuation"]
PROJECTION_MODELS: tuple[ProjectionModel, ...] = ("raw", "relative_attenuation")


def validate_projection_model(value: str) -> ProjectionModel:
    """Validate and normalize the attenuation model used by every backend."""
    normalized = value.replace("-", "_")
    if normalized not in PROJECTION_MODELS:
        choices = ", ".join(model.replace("_", "-") for model in PROJECTION_MODELS)
        raise ValueError(f"projection_model must be one of: {choices}")
    return normalized  # type: ignore[return-value]


def transform_voxel_value(
    value: float,
    *,
    projection_model: str = "raw",
    hu_air_threshold: float | None = -900.0,
    clamp_negative_to_zero: bool = True,
) -> float:
    """Convert one voxel value into the quantity integrated along a ray.

    ``raw`` preserves PyDRR's original qualitative sum. ``relative_attenuation``
    converts calibrated CT values to water-relative attenuation using
    ``max(0, 1 + HU / 1000)``. The latter is energy independent and should not
    be interpreted as an absolute linear attenuation coefficient.
    """
    model = validate_projection_model(projection_model)
    if hu_air_threshold is not None and value < hu_air_threshold:
        return 0.0
    if model == "relative_attenuation":
        return max(0.0, 1.0 + value / 1000.0)
    if clamp_negative_to_zero:
        return max(value, 0.0)
    return value
