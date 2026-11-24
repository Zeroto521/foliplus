"""The ``LayerData`` FieldSpec: the CONF shape of one collected layer.

Split out of ``control.py`` because the alias table is data, not control
behaviour, and it was one of the two blocks keeping that module over the
300-code-line criterion (see ``script/check/module_size_check.py``).
"""

from __future__ import annotations

from typing import Annotated, get_args

from foliplus._config_schema import FieldSpec

from ._role import LayerRole

LAYER_DATA_FIELDS = {
    "data": Annotated[
        list,
        FieldSpec(
            name="LayerData",
            shape=[
                {
                    "name": "string",
                    "id": "string",
                    "role": get_args(LayerRole),
                    "show": "bool",
                    # Optional: what Python computed for the author's
                    # per-feature paint (explore's baked colors). The panel
                    # reads it as the author default behind fill by value;
                    # absent on a layer with no author paint.
                    "fillAuthor": (
                        {
                            "perFeature": "bool",
                            "distinct": "number",
                            "stops": "array_string",
                            "capped": ("bool", "?"),
                            # The scale the author mounted (continuous) or
                            # the classified blocks they drew (stepped).
                            "scale": (
                                {
                                    "kind": ("continuous", "stepped"),
                                    "column": ("string", "?"),
                                    "vmin": ("number", "?"),
                                    "vmax": ("number", "?"),
                                    "levels": ("number", "?"),
                                    "method": (("equal", "null"), "?"),
                                },
                                "?",
                            ),
                        },
                        "?",
                    ),
                    # Optional: the author-declared zoom range,
                    # normalised from foliplus={"zoom_range": {...}}.
                    # Absent when the layer declares none - the
                    # visibility policy then keeps the map range.
                    "zoomRange": (
                        {"min": "number", "max": "number"},
                        "?",
                    ),
                }
            ],
        ),
    ]
}
