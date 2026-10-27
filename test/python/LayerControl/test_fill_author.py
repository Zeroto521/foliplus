"""Rendering tests for the per-layer author-fill metadata (CONFIG data[].fillAuthor)."""

from __future__ import annotations

import importlib
import json

import folium

from foliplus import LayerControl

_layer_control_mod = importlib.import_module("foliplus.LayerControl")


def _collection(colors: list[str | None], *, column: str = "cat") -> dict:
    features: list[dict] = []
    for i, color in enumerate(colors):
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
    return {"type": "FeatureCollection", "features": features}


def _geo(
    colors: list[str | None], *, column: str = "cat", style: bool = True
) -> folium.GeoJson:
    layer = folium.GeoJson(_collection(colors, column=column), name="Facility Points")
    if style:
        layer.style_function = lambda feature: {
            "fillColor": feature["properties"].get("__folium_color", "#3388ff"),
        }
    return layer


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


def _meta(layer: folium.GeoJson) -> dict:
    return _conf(_render(layer))["data"][0]["fillAuthor"]


def test_multi_colour_explore_layer_carries_fill_author():
    meta = _meta(_geo(["#0d0887", "#f0f921"]))

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
    meta = _meta(_geo(["#1f77b4", "#1f77b4"]))

    assert meta["perFeature"] is False
    assert meta["fields"] == []


def test_layer_without_the_property_has_no_fill_author():
    data = _conf(_render(_geo([None, None])))["data"][0]

    assert "fillAuthor" not in data


def test_numeric_column_is_tagged_numeric():
    layer = _geo(["#0d0887", "#f0f921"], column="score")
    for value, feature in zip((1, 2), layer.data["features"], strict=True):
        feature["properties"]["score"] = value
    field = _meta(layer)["fields"][0]

    assert field["kind"] == "numeric"
    # Keys are the normalized value strings: an integer column keys "1"/"2",
    # never "1.0"/"2.0". A float column keeps its float repr ("1.0"): the key
    # is str(value), not a dtype-aware cast — task-51/task-53 read it verbatim.
    assert field["mapping"] == {"1": "#0d0887", "2": "#f0f921"}


def test_field_mapping_is_truncated_past_the_cap():
    field = _meta(_geo([f"#{i:02x}00aa" for i in range(60)]))["fields"][0]

    assert field["truncated"] is True
    assert field["other"] == 10
    assert len(field["mapping"]) == 50


def _add_column(layer: folium.GeoJson, name: str, values: list[object]) -> None:
    for value, feature in zip(values, layer.data["features"], strict=True):
        feature["properties"][name] = value


def test_bool_and_non_primitive_columns_are_disqualified():
    layer = _geo(["#0d0887", "#f0f921"])
    _add_column(layer, "flag", [True, False])
    meta = _meta(layer)

    assert meta["perFeature"] is True
    assert [field["name"] for field in meta["fields"]] == ["cat"]


def test_column_that_maps_one_value_to_two_colours_is_disqualified():
    layer = _geo(["#0d0887", "#f0f921"])
    _add_column(layer, "dup", ["x", "x"])
    _add_column(layer, "score", [1, 2])

    names = [field["name"] for field in _meta(layer)["fields"]]
    assert "dup" not in names
    assert "score" in names


def test_json_string_data_is_parsed():
    layer = folium.GeoJson(
        json.dumps(_collection(["#0d0887", "#f0f921"])), name="Json String"
    )
    meta = _meta(layer)

    assert meta["perFeature"] is True
    assert meta["fields"][0]["name"] == "cat"


def test_invalid_json_string_data_is_ignored():
    layer = _geo(["#0d0887", "#f0f921"])
    layer.data = "{not json"

    assert _layer_control_mod._fill_author(layer) is None


def test_non_mapping_data_is_ignored():
    layer = _geo(["#0d0887", "#f0f921"])
    layer.data = [{"type": "Feature", "properties": {}}]

    assert _layer_control_mod._fill_author(layer) is None


def test_missing_features_list_is_ignored():
    layer = _geo(["#0d0887", "#f0f921"])
    layer.data = {"type": "FeatureCollection"}

    assert _layer_control_mod._fill_author(layer) is None


def test_feature_without_properties_is_skipped():
    layer = _geo(["#0d0887", "#f0f921"], style=False)
    layer.data["features"].insert(0, None)
    layer.data["features"].insert(1, {"type": "Feature", "properties": None})
    meta = _meta(layer)

    assert meta["perFeature"] is True
    assert meta["fields"][0]["name"] == "cat"


def test_large_layer_reports_only_the_colour_set(monkeypatch):
    monkeypatch.setattr(_layer_control_mod, "_FILL_AUTHOR_FEATURE_LIMIT", 1)
    meta = _meta(_geo(["#0d0887", "#f0f921"]))

    assert meta["perFeature"] is True
    assert meta["fields"] == []
