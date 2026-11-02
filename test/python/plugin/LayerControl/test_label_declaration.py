"""The author-facing declaration key: ``label``.

A layer declares its label defaults on itself, not on the control:
``folium.GeoJson(..., foliplus={"label": ...})`` lands the dict on the layer's
own options, and the JS annotation manager reads it from there. The Python side
only has to keep collecting the layer.

That documented channel is also what pins the supported floor — folium only
forwards those kwargs onto a layer's options from 0.15 on.
"""

from __future__ import annotations

import json

import folium

from foliplus import LayerControl

_EMPTY = json.dumps({"type": "FeatureCollection", "features": []})


def test_label_key_reaches_the_layer_options() -> None:
    """The documented author channel lands the declaration on the layer."""
    m = folium.Map()
    ctrl = LayerControl().add_to(m)
    layer = folium.GeoJson(
        _EMPTY, name="declared", foliplus={"label": {"field": "name"}}
    )
    layer.add_to(ctrl)

    # folium's typing does not declare `options` on a Layer, hence the
    # defensive read; the constructor above is what pins the supported floor.
    options = getattr(layer, "options", {})
    assert options.get("foliplus") == {"label": {"field": "name"}}

    data = ctrl._extra_config()["data"]  # type: ignore[attr-defined]
    assert data[0]["name"] == "declared"
