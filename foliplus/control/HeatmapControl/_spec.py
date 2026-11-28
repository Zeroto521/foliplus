"""The public CONFIG surface of HeatmapControl: type aliases and field specs.

Split out of ``control.py`` because the schema metadata is data, not control
behaviour, and the inline ``Annotated`` declarations were the block keeping
that module over the 300-code-line criterion (see
``script/check/module_size_check.py``). These are the same aliases the
``__init__`` signature used to carry inline: the generated config schema
reflects them through ``get_type_hints``, so moving them here must keep
``foliplus/js/config-schema.ts`` byte-identical.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from foliplus._config_schema import FieldSpec
from foliplus._declaration import NumberFormat

METHOD = Literal["jenks", "quantile", "equal", "heads"]
AGG = Literal["count", "sum", "avg", "min", "max"]
LABEL_FORMAT = Annotated[
    # The alias, not a second literal list: the generated NumberStyle union is
    # derived from _declaration.label.NumberFormat.
    NumberFormat,
    FieldSpec(name="NumberStyle", note="Number format for hexagon value labels."),
]

#: The point layer selected on first load; a persisted user selection wins.
LAYER_ARG = Annotated[
    str | None,
    FieldSpec(
        ts="",
        note="Point layer name selected on first load; a persisted user selection wins.",
    ),
]

#: The aggregation field selected on first load (and what a filter binds to).
FIELD_ARG = Annotated[
    str | None,
    FieldSpec(
        ts="",
        note="Aggregation field selected on first load (and the field a declared filter range binds to); a persisted user selection wins.",
    ),
]

#: The declared starting filter on the aggregation field.
FILTER_ARG = Annotated[
    dict[str, Any] | None,
    FieldSpec(
        ts="",
        note=(
            "Declared filter on the aggregation field: a mapping with min and max "
            "(bound to field=), normalised to the shared filter AST; a persisted "
            "user filter wins."
        ),
    ),
]

#: The color scheme names the panel offers.
SCHEMES_ARG = Annotated[
    list[str], FieldSpec(ts="", note="Available color scheme names.")
]

#: The built-in scheme list, shared by the constructor default and the schema.
DEFAULT_SCHEMES: list[str] = [
    "Blues",
    "Greens",
    "Reds",
    "Oranges",
    "Purples",
    "YlOrRd",
    "Viridis",
]

#: The declared visibility window over the map zoom levels.
ZOOM_RANGE_ARG = Annotated[
    dict[str, Any] | None,
    FieldSpec(
        ts="ZoomRange",
        name="ZoomRange",
        shape={"min": "number", "max": "number"},
        config_key="zoom_range",
        note=(
            "Declared zoom range: the control is visible only while the map's "
            "zoom is inside it; a malformed or unreachable range is treated as "
            "undeclared."
        ),
    ),
]

#: The declared LayerControl folder the control's layer joins.
FOLDER_ARG = Annotated[
    str | None,
    FieldSpec(
        ts="string",
        note=(
            "Declared folder name the control's layer joins in the LayerControl "
            "panel: the layer registers with this folder assignment, so a new "
            "page (no persisted layout) already places it inside the folder. "
            "A user drag to another folder wins over this declaration."
        ),
    ),
]
