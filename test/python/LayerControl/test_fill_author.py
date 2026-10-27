"""Rendering tests for the per-layer author-fill metadata (CONFIG data[].fillAuthor)."""

from __future__ import annotations

import json

import folium
from conftest import _js  # noqa: F401  (kept for the browser sibling's import style)

from foliplus import LayerControl


def _geo(color_per_feature: list[str | None], *, column: str = "cat") -> folium.GeoJson:
    features = []
    for i, color in enumerate(color_per_feature):
        props: dict[str, object] = {column: f"v{i}"}
        if color is not None:
            props["__folium_color"] = color
        features.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": {
                    "type": "Point",
                    "coordinates": [119.30 + i * 0.01, 26.08],
                },
            }
        )
    return folium.GeoJson(
        json.dumps({"type": "FeatureCollection", "features": features}),
        name="Facility Points",
        style_function=lambda feature: {
            "fillColor": feature["properties"].get("__folium_color", "#3388ff"),
        },
    )


def _render(*layers: folium.Layer) -> str:
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    for layer in layers:
        layer.add_to(m)
    LayerControl().add_to(m)
    return m.get_root().render()


def _conf(html: str) -> dict:
    marker = "CONFIG = "
    start = html.index(marker) + len(marker)
    end = html.index(";", start)
    return json.loads(html[start:end])


def test_multi_colour_explore_layer_carries_fill_author():
    meta = _conf(_render(_geo(["#0d0887", "#f0f921"])))["data"][0]["fillAuthor"]

    assert meta["perFeature"] is True
    assert meta["fields"] == [
        {
            "name": "cat",
            "kind": "categorical",
            "mapping": {"v0": "#0d0887", "v1": "#f0f921"},
            "other": 0,
            "truncated": False,
        }
    ]


def test_single_colour_layer_is_not_per_feature():
    meta = _conf(_render(_geo(["#1f77b4", "#1f77b4"])))["data"][0]["fillAuthor"]

    assert meta["perFeature"] is False
    assert meta["fields"] == []


def test_layer_without_the_property_has_no_fill_author():
    data = _conf(_render(_geo([None, None])))["data"][0]

    assert "fillAuthor" not in data


def test_numeric_column_is_tagged_numeric():
    features = []
    for value, color in ((1, "#0d0887"), (2, "#f0f921")):
        features.append(
            {
                "type": "Feature",
                "properties": {"__folium_color": color, "score": value},
                "geometry": {"type": "Point", "coordinates": [119.3, 26.08]},
            }
        )
    layer = folium.GeoJson(
        json.dumps({"type": "FeatureCollection", "features": features}),
        name="Score",
    )
    meta = _conf(_render(layer))["data"][0]["fillAuthor"]

    assert meta["perFeature"] is True
    assert meta["fields"][0]["kind"] == "numeric"
    # Keys are the normalized value strings: an integer column keys "1"/"2",
    # never "1.0"/"2.0" — task-51/task-53 read this mapping verbatim.
    assert meta["fields"][0]["mapping"] == {"1": "#0d0887", "2": "#f0f921"}


def test_field_mapping_is_truncated_past_the_cap():
    colors = [f"#{i:02x}00aa" for i in range(60)]
    meta = _conf(_render(_geo(colors)))["data"][0]["fillAuthor"]

    assert meta["perFeature"] is True
    field = meta["fields"][0]
    assert field["truncated"] is True
    assert field["other"] == 10
    assert len(field["mapping"]) == 50
