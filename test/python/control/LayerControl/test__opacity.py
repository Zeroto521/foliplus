"""The opacity declaration channel: whole-layer opacity and the marker glyph /
chassis alpha, read off the layer namespace.

These three declarations are read-time defaults for the JS panel (the slider
starts there and Reset returns to it), never draw overrides — folium's own
``opacity=`` / ``colorOpacity`` kwargs remain the author DRAW value and are
read first. The readers are split into ``_opacity.py``; the shared
``foliplus_namespace`` read and the unknown-key warning family stay in
``_layer.py``. These tests pin the structural shape gate (scalar vs block) and
the warning an out-of-range value produces; the JS panel owns the semantic
vocabulary.
"""

from __future__ import annotations

import json
import re
import warnings

import folium
import pytest
from conftest import feature_collection

from foliplus import LayerControl
from foliplus.control.LayerControl._opacity import (
    declared_icon_color_opacity,
    declared_marker_color_opacity,
    declared_opacity,
)


def _render(*layers: folium.Layer) -> str:
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    for layer in layers:
        layer.add_to(m)
    LayerControl().add_to(m)
    return m.get_root().render()


def _declared_namespace(html: str) -> dict:
    """The layer's foliplus options as rendered into the JS config."""
    match = re.search(r"[\'\"]?foliplus[\'\"]?\s*:\s*\{", html)
    if match is None:
        raise AssertionError("foliplus namespace not found in the rendered HTML")
    start = match.end() - 1
    depth = 0
    for index in range(start, len(html)):
        char = html[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                block = html[start : index + 1]
                return json.loads(re.sub(r",(\s*[}\]])\1", r"\1", block))
    raise AssertionError("unterminated foliplus namespace in rendered HTML")


def _geo(name: str = "Declared", **options: object) -> folium.GeoJson:
    return folium.GeoJson(feature_collection(), name=name, **options)


def test_declared_opacity_reaches_layer_options() -> None:
    """The whole-layer opacity declaration lands on the layer options."""
    layer = _geo(foliplus={"opacity": 0.6})
    _render(layer)
    assert layer.options["foliplus"] == {"opacity": 0.6}


def test_declared_opacity_returns_normalised_value() -> None:
    layer = _geo(foliplus={"opacity": 0.6})
    assert declared_opacity(layer, "Declared") == 0.6


def test_undeclared_opacity_is_none() -> None:
    layer = _geo()
    assert declared_opacity(layer, "Declared") is None


def test_out_of_range_opacity_is_dropped_with_a_warning() -> None:
    with pytest.warns(UserWarning, match="expected a number from 0 to 1"):
        layer = _geo(foliplus={"opacity": 1.5})
        assert declared_opacity(layer, "Declared") is None


def test_bool_opacity_is_dropped_with_a_warning() -> None:
    with pytest.warns(UserWarning, match="expected a number from 0 to 1"):
        layer = _geo(foliplus={"opacity": True})
        assert declared_opacity(layer, "Declared") is None


def test_declared_icon_color_opacity_reads_block() -> None:
    layer = _geo(foliplus={"icon": {"colorOpacity": 60}})
    assert declared_icon_color_opacity(layer, "Declared") == 60


def test_declared_marker_color_opacity_reads_block() -> None:
    layer = _geo(foliplus={"marker": {"colorOpacity": 60}})
    assert declared_marker_color_opacity(layer, "Declared") == 60


def test_icon_block_when_not_a_mapping_is_none() -> None:
    layer = _geo(foliplus={"icon": "red"})
    assert declared_icon_color_opacity(layer, "Declared") is None


def test_marker_block_when_not_a_mapping_is_none() -> None:
    layer = _geo(foliplus={"marker": "red"})
    assert declared_marker_color_opacity(layer, "Declared") is None


def test_icon_color_opacity_out_of_range_warns() -> None:
    with pytest.warns(UserWarning, match="expected a whole number from 0 to 100"):
        layer = _geo(foliplus={"icon": {"colorOpacity": 101}})
        assert declared_icon_color_opacity(layer, "Declared") is None


def test_marker_color_opacity_out_of_range_warns() -> None:
    with pytest.warns(UserWarning, match="expected a whole number from 0 to 100"):
        layer = _geo(foliplus={"marker": {"colorOpacity": -1}})
        assert declared_marker_color_opacity(layer, "Declared") is None


def test_missing_block_subkey_is_none() -> None:
    layer = _geo(foliplus={"icon": {}})
    assert declared_icon_color_opacity(layer, "Declared") is None


def test_non_icon_key_does_not_touch_opacity() -> None:
    layer = _geo(foliplus={"icon_size": 24})
    assert declared_icon_color_opacity(layer, "Declared") is None


def test_collection_warns_once_per_layer() -> None:
    """Collection validates the shape once per layer; an out-of-range opacity
    on two layers warns twice, each attributable."""
    layers = [_geo(name=f"L{i}", foliplus={"opacity": 2.0}) for i in range(2)]
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        _render(*layers)
    opacity = [w for w in caught if "expected a number from 0 to 1" in str(w.message)]
    assert len(opacity) == 2
    for index, warning in enumerate(opacity):
        assert f"layer 'L{index}'" in str(warning.message)


def test_opacity_block_does_not_touch_leaflet_options() -> None:
    """The declaration never writes a Leaflet opacity option — folium's
    ``opacity=`` stays the author DRAW value; this is only a read-time default."""
    layer = _geo(foliplus={"opacity": 0.6})
    _render(layer)
    assert "opacity" not in layer.options
