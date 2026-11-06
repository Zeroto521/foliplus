"""HeatmapControl static types.

These aliases are shared by the control module and any helper; nothing here
touches the map or the CONF payload, so they stay importable without Leaflet.
"""

from __future__ import annotations

from typing import Annotated, Literal

from foliplus._config_schema import FieldSpec

METHOD = Literal["jenks", "quantile", "equal", "heads"]

AGG = Literal["count", "sum", "avg", "min", "max"]

LABEL_FORMAT = Annotated[
    Literal["auto", "int", "comma", "percent"],
    FieldSpec(name="NumberStyle", note="Number format for hexagon value labels."),
]
