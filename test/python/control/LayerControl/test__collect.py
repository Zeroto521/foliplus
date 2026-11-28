"""The layer collection pass: CONFIG data[] for one rendered control.

``collect_layer_data`` unions the control's children with the parent map's,
deduplicates by ``get_name()``, folds each layer's declarations into one entry
and hands the rows back in the panel's order (overlays first, then base maps).
These tests drive it with real folium layers and assert the shipped row
(name/id/role/show), the dedup contract, the declaration facts and the
validate-on-collect warnings. The walk was split out of control.py in #1319
to meet the 300-code-line criterion, so its consumers (the render tests) are
not a substitute for pinning the collection contract itself.
"""

from __future__ import annotations

import warnings

import folium
import pytest
from conftest import feature_collection, point_feature

from foliplus import LayerControl
from foliplus.control.LayerControl._collect import collect_layer_data


def _map() -> folium.Map:
    return folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)


def _control_with(*layers: folium.Layer) -> LayerControl:
    m = _map()
    for layer in layers:
        layer.add_to(m)
    control = LayerControl()
    control.add_to(m)
    return control


def _row(data: dict[str, object], name: str) -> dict[str, object]:
    rows = data["data"]
    matches = [row for row in rows if row["name"] == name]
    assert len(matches) == 1, rows
    return matches[0]


def test_collect_layer_data_returns_one_entry_per_layer() -> None:
    a = folium.GeoJson(feature_collection(), name="a")
    b = folium.GeoJson(feature_collection(), name="b")
    data = collect_layer_data(_control_with(a, b))
    assert [row["name"] for row in data["data"]] == ["a", "b"], data


def test_collect_layer_data_row_has_the_core_shape() -> None:
    layer = folium.GeoJson(feature_collection(), name="a")
    row = _row(collect_layer_data(_control_with(layer)), "a")
    for key in ("name", "id", "role", "show"):
        assert key in row, key
    assert row["id"] == layer.get_name()
    assert row["role"] == "overlay"
    assert row["show"] is True


def test_collect_layer_data_deduplicates_one_layer_reached_twice() -> None:
    layer = folium.GeoJson(feature_collection(), name="a")
    m = _map()
    control = LayerControl()
    control.add_to(m)
    # The same object is a child of the control and of the parent map; the walk
    # must emit it once, not twice.
    layer.add_to(control)
    m.add_child(layer)
    data = collect_layer_data(control)
    assert [row["name"] for row in data["data"]] == ["a"], data


def test_collect_layer_data_skips_the_control_itself() -> None:
    # The control is a child of the map but not a Layer; the walk must skip it.
    layer = folium.GeoJson(feature_collection(), name="a")
    data = collect_layer_data(_control_with(layer))
    assert len(data["data"]) == 1, data


def test_collect_layer_data_orders_overlays_before_base_maps() -> None:
    overlay = folium.GeoJson(feature_collection(), name="data")
    base = folium.TileLayer("OpenStreetMap", name="basemap")
    data = collect_layer_data(_control_with(base, overlay))
    assert [row["role"] for row in data["data"]] == ["overlay", "base"], data


def test_collect_layer_data_carries_the_declared_zoom_range() -> None:
    layer = folium.GeoJson(
        feature_collection(), name="a", foliplus={"zoom_range": {"min": 2, "max": 9}}
    )
    row = _row(collect_layer_data(_control_with(layer)), "a")
    assert row["zoom_range"] == {"min": 2, "max": 9}, row


def test_collect_layer_data_carries_the_declared_folder() -> None:
    layer = folium.GeoJson(feature_collection(), name="a", foliplus={"folder": "Ops"})
    row = _row(collect_layer_data(_control_with(layer)), "a")
    assert row["folder"] == "Ops", row


def test_collect_layer_data_carries_the_author_paint_fact() -> None:
    features = feature_collection(
        point_feature(119.3, 26.08, {"__folium_color": "#ff0000"}),
        point_feature(119.4, 26.09, {"__folium_color": "#00ff00"}),
    )
    layer = folium.GeoJson(features, name="a")
    row = _row(collect_layer_data(_control_with(layer)), "a")
    author = row["fill_author"]
    assert author["distinct"] == 2, author
    assert author["stops"] == ["#ff0000", "#00ff00"], author


def test_collect_layer_data_carries_the_normalised_label_fact() -> None:
    layer = folium.GeoJson(
        feature_collection(),
        name="a",
        foliplus={"label": {"field": "name", "color": "#0F0"}},
    )
    row = _row(collect_layer_data(_control_with(layer)), "a")
    assert row["label"] == {
        "field": "name",
        "color": "#00ff00",
        "show": True,
    }, row


def test_collect_layer_data_warns_on_an_invalid_label_and_omits_the_fact() -> None:
    layer = folium.GeoJson(
        feature_collection(),
        name="a",
        foliplus={"label": {"format": "thousands"}},
    )
    with pytest.warns(UserWarning, match="with a format 'thousands'"):
        row = _row(collect_layer_data(_control_with(layer)), "a")
    assert "label" not in row


def test_collect_layer_data_carries_the_container_own_label_fact() -> None:
    # A container row reads the declaration written on the container itself: the
    # group is the row, so its own label block is the row's label fact.
    group = folium.FeatureGroup(
        name="grp",
        foliplus={"label": {"field": "name", "color": "#0F0"}},
    )
    folium.GeoJson(feature_collection(), name="child").add_to(group)
    row = _row(collect_layer_data(_control_with(group)), "grp")
    assert row["label"] == {
        "field": "name",
        "color": "#00ff00",
        "show": True,
    }, row


def test_collect_layer_data_does_not_hoist_a_child_declaration_onto_the_container() -> (
    None
):
    # A declaration belongs to the layer that carries it: a child layer's label
    # block is neither inherited by the container row nor reported as an error.
    group = folium.FeatureGroup(name="grp")
    folium.GeoJson(
        feature_collection(),
        name="child",
        foliplus={"label": {"field": "name"}},
    ).add_to(group)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        row = _row(collect_layer_data(_control_with(group)), "grp")
    assert "label" not in row, row
    assert not caught, [str(w.message) for w in caught]


def test_collect_layer_data_warns_on_a_malformed_declaration() -> None:
    layer = folium.GeoJson(feature_collection(), name="a", foliplus={"border": "nope"})
    with pytest.warns(UserWarning):
        collect_layer_data(_control_with(layer))
