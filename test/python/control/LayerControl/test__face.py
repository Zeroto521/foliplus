"""The icon / marker declaration block readers
(foliplus.control.LayerControl._face).

The shared normaliser owns the spelling rule and the per-value shape; this
reader owns the layer channel: it reads the block off one layer's
`foliplus={...}` namespace and warns once, the same single read point the
other declared* readers use.
"""

from __future__ import annotations

import json
import re

import folium
import pytest
from conftest import feature_collection

from foliplus import LayerControl
from foliplus.control.LayerControl._face import (
    declared_icon_block,
    declared_marker_block,
)


def _render(*layers: folium.Layer) -> str:
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    for layer in layers:
        layer.add_to(m)
    LayerControl().add_to(m)
    return m.get_root().render()


def _declared_namespace(html: str) -> dict:
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
                return json.loads(re.sub(r",(\s*[}\]])", r"\1", block))
    raise AssertionError("unterminated foliplus namespace in rendered HTML")


def _geo(name: str = "Declared", **options: object) -> folium.GeoJson:
    return folium.GeoJson(feature_collection(), name=name, **options)


def test_declared_icon_block_is_read() -> None:
    layer = _geo(name="IconA", foliplus={"icon": {"glyph": "star", "color": "#FF0000"}})
    assert declared_icon_block(layer, "IconA") == {"glyph": "star", "color": "#ff0000"}


def test_the_snake_alpha_spelling_is_read_and_canonicalised() -> None:
    layer = _geo(name="IconB", foliplus={"icon": {"color_opacity": 60}})
    assert declared_icon_block(layer, "IconB") == {"colorOpacity": 60}


def test_an_undeclared_icon_block_is_none() -> None:
    assert declared_icon_block(_geo(name="IconC"), "IconC") is None
    assert declared_icon_block(_geo(name="IconD", foliplus={}), "IconD") is None


def test_a_non_mapping_icon_block_is_none_and_warns() -> None:
    with pytest.warns(UserWarning, match="expected a mapping"):
        assert (
            declared_icon_block(_geo(name="IconE", foliplus={"icon": "red"}), "IconE")
            is None
        )


def test_an_unknown_icon_sub_key_warns_with_the_layer_name() -> None:
    layer = _geo(name="IconF", foliplus={"icon": {"glyph": "star", "colour": "#fff"}})
    with pytest.warns(UserWarning, match="unknown icon sub-key 'colour'"):
        assert declared_icon_block(layer, "IconF") == {"glyph": "star"}


def test_declared_marker_block_is_read() -> None:
    layer = _geo(name="MarkerA", foliplus={"marker": {"colorOpacity": 40}})
    assert declared_marker_block(layer, "MarkerA") == {"colorOpacity": 40}


def test_an_unknown_marker_sub_key_warns() -> None:
    layer = _geo(name="MarkerB", foliplus={"marker": {"glyph": "star"}})
    with pytest.warns(UserWarning, match="unknown marker sub-key 'glyph'"):
        assert declared_marker_block(layer, "MarkerB") == {}


def test_the_declaration_reaches_the_rendered_layer_options() -> None:
    # The rendered namespace is folium-version-dependent: newer folium camelizes
    # the nested dict keys, 0.15.x keeps the author's snake spelling. The JS
    # reader accepts both, so what matters is that the declaration survives the
    # render with its values intact (compare spelling-insensitively).
    layer = _geo(
        name="IconG",
        foliplus={"icon": {"glyph": "star", "color": "#00ff00", "color_opacity": 30}},
    )
    namespace = _declared_namespace(_render(layer))
    rendered = {
        key.lower().replace("_", ""): value for key, value in namespace["icon"].items()
    }
    assert rendered == {"glyph": "star", "color": "#00ff00", "coloropacity": 30}
