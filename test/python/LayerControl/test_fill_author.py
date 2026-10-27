"""Rendering tests for the per-layer author-fill metadata (CONFIG data[].fillAuthor)."""

from __future__ import annotations

import importlib
import json

import folium
import pytest

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
    # Numeric fields also carry the author palette in value order, so the
    # client can offer colour-by-value over the author's own colours.
    assert field["orderedColors"] == ["#0d0887", "#f0f921"]
    assert field["classes"] == 2


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


def test_numeric_author_palette_is_sorted_by_value():
    layer = _geo(["#0d0887", "#6a00a8", "#b12a90", "#e16462"], column="score")
    for value, feature in zip((40, 10, 30, 20), layer.data["features"], strict=True):
        feature["properties"]["score"] = value
    field = _meta(layer)["fields"][0]

    # Value order, not feature order: 10 -> #6a00a8, 20 -> #e16462, 30 -> #b12a90,
    # 40 -> #0d0887.
    assert field["orderedColors"] == ["#6a00a8", "#e16462", "#b12a90", "#0d0887"]
    assert field["classes"] == 4


def test_truncated_numeric_field_caps_the_author_palette():
    layer = _geo([f"#{i:02x}00aa" for i in range(60)], column="score")
    for value, feature in zip(range(60), layer.data["features"], strict=True):
        feature["properties"]["score"] = value
    field = _meta(layer)["fields"][0]

    # The payload stays bounded: the palette describes the kept values only,
    # and the class count cannot exceed them.
    assert field["truncated"] is True
    assert len(field["orderedColors"]) <= 50
    assert field["classes"] == len(field["orderedColors"])
    assert set(field["orderedColors"]) <= set(field["mapping"].values())


def _field(meta: dict, name: str) -> dict | None:
    return next((field for field in meta["fields"] if field["name"] == name), None)


def _numpy():
    pytest.importorskip("numpy")
    import numpy as np

    return np


def _fields_for(values: list[object], colors: list[str]) -> list[dict]:
    rows = [
        ({"score": value, "__folium_color": color}, color)
        for value, color in zip(values, colors, strict=True)
    ]
    return _layer_control_mod._fill_author_fields(rows)


def test_numpy_integer_scalars_are_numeric_with_integer_keys():
    np = _numpy()
    fields = _fields_for(
        [np.int64(10), np.int64(20), np.int64(30)],
        ["#0d0887", "#f0f921", "#6a00a8"],
    )

    field = _field({"fields": fields}, "score")
    assert field is not None, fields
    assert field["kind"] == "numeric"
    # np.int64(10) and 10 are the same value: the key prints as the integer.
    assert field["mapping"] == {"10": "#0d0887", "20": "#f0f921", "30": "#6a00a8"}
    assert field["orderedColors"] == ["#0d0887", "#f0f921", "#6a00a8"]
    assert field["classes"] == 3


def test_numpy_float_scalars_keep_float_keys():
    np = _numpy()
    field = _field(
        {
            "fields": _fields_for(
                [np.float32(1.5), np.float64(2.5)], ["#0d0887", "#f0f921"]
            )
        },
        "score",
    )

    assert field is not None
    assert field["kind"] == "numeric"
    assert field["mapping"] == {"1.5": "#0d0887", "2.5": "#f0f921"}


def test_missing_and_mixed_values_disqualify_the_column():
    np = _numpy()
    for missing in (None, float("nan"), np.float32("nan")):
        fields = _fields_for([missing, 20], ["#0d0887", "#f0f921"])
        assert _field({"fields": fields}, "score") is None, missing

    # A mixed int/string column can never be a numeric ramp; it falls back to
    # the categorical mapping (the by-category arm does not exist yet, so the
    # panel shows its read-only per-feature state).
    mixed = _fields_for([10, "twenty"], ["#0d0887", "#f0f921"])
    mixed_field = _field({"fields": mixed}, "score")
    assert mixed_field is None or mixed_field["kind"] == "categorical"

    boolean = _fields_for([True, False], ["#0d0887", "#f0f921"])
    assert _field({"fields": boolean}, "score") is None

    numpy_bool = _fields_for([np.bool_(True), np.bool_(False)], ["#0d0887", "#f0f921"])
    assert _field({"fields": numpy_bool}, "score") is None


def test_integer_dtype_geodataframe_is_numeric():
    gpd = pytest.importorskip("geopandas")
    pytest.importorskip("shapely")
    from shapely.geometry import Point

    gdf = gpd.GeoDataFrame(
        {"score": [10, 20, 30], "ratio": [1.5, 2.5, 3.5], "cat": ["a", "b", "c"]},
        geometry=[Point(0, 0), Point(1, 1), Point(2, 2)],
        crs="EPSG:4326",
    )
    gdf["__folium_color"] = ["#0d0887", "#f0f921", "#6a00a8"]
    layer = folium.GeoJson(gdf, style_function=lambda feature: {})
    meta = _meta(layer)

    score = _field(meta, "score")
    assert score is not None, meta
    assert score["kind"] == "numeric"
    # An int64 column keys integers, not their float spelling.
    assert set(score["mapping"]) == {"10", "20", "30"}
    assert score["classes"] == 3
    # A float64 column in the same frame keeps its float repr.
    ratio = _field(meta, "ratio")
    assert ratio is not None and ratio["kind"] == "numeric"
    assert set(ratio["mapping"]) == {"1.5", "2.5", "3.5"}
    # A string column stays categorical.
    cat = _field(meta, "cat")
    assert cat is not None and cat["kind"] == "categorical"


def test_non_primitive_value_after_a_numeric_row_disqualifies_the_column():
    rows = [
        ({"score": 10, "__folium_color": "#0d0887"}, "#0d0887"),
        ({"score": {"nested": 1}, "__folium_color": "#f0f921"}, "#f0f921"),
    ]
    fields = _layer_control_mod._fill_author_fields(rows)

    # A value that cannot key a mapping disqualifies the whole column, even
    # when the first row already looked numeric.
    assert _field({"fields": fields}, "score") is None


def test_shared_colour_values_dedupe_the_author_palette():
    rows = [
        ({"score": 10, "__folium_color": "#0d0887"}, "#0d0887"),
        ({"score": 20, "__folium_color": "#0d0887"}, "#0d0887"),
        ({"score": 30, "__folium_color": "#f0f921"}, "#f0f921"),
    ]
    field = _field({"fields": _layer_control_mod._fill_author_fields(rows)}, "score")

    assert field is not None
    # Two values may share one colour: the palette lists each colour once.
    assert field["orderedColors"] == ["#0d0887", "#f0f921"]
    assert field["classes"] == 2
