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


def test_collect_layer_data_without_a_parent_map_returns_no_rows() -> None:
    # A control that was never added to a map has no parent to walk.
    data = collect_layer_data(LayerControl())
    assert data["data"] == [], data


def test_collect_layer_data_visits_a_layer_shared_by_two_containers_once() -> None:
    # The same leaf can hang off two containers; the container walk must visit
    # it once, and both container rows still render.
    leaf = folium.GeoJson(feature_collection(), name="leaf")
    first = folium.FeatureGroup(name="first")
    second = folium.FeatureGroup(name="second")
    leaf.add_to(first)
    leaf.add_to(second)
    data = collect_layer_data(_control_with(first, second))
    assert [row["name"] for row in data["data"]] == ["first", "second"], data


def test_collect_layer_data_carries_the_declared_filter() -> None:
    layer = folium.GeoJson(
        feature_collection(),
        name="pop",
        foliplus={"filter": {"field": "pop", "min": 0, "max": 100}},
    )
    row = _row(collect_layer_data(_control_with(layer)), "pop")
    assert row["filter"] == {
        "kind": "atom",
        "field": "pop",
        "op": "between",
        "range": [0, 100],
    }, row


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


def test_collect_layer_data_carries_the_container_own_declared_facts() -> None:
    # A container row reads the declarations written on the container itself: the
    # group is the row, so its own label block is the row's fact. `folder` is
    # not among them any more - see TestFolderRootOnly.
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
    assert "folder" not in row, row


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


class TestFolderRootOnly:
    """Folders are root-only: a declaration that would nest is ignored + warns.

    The data model still renders author-built container nesting (read-only);
    this is about the declaration channel, which must not create folder
    nesting. A dropped declaration is not claimed either, so a central
    `folders=` entry stays "unclaimed" rather than hiding an ignored
    declaration.
    """

    @pytest.fixture(autouse=True)
    def _fresh_reports(self) -> None:
        # warn_foliplus deduplicates through a process-wide set; clear it so
        # each test sees the warning it would see on a fresh render.
        from foliplus import _declaration

        _declaration.foliplus_reports.clear()

    def test_container_folder_declaration_is_ignored_and_warns_once(self) -> None:
        group = folium.FeatureGroup(name="grp", foliplus={"folder": "Ops"})
        folium.GeoJson(feature_collection(), name="child").add_to(group)
        control = _control_with(group)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            data = collect_layer_data(control)
            collect_layer_data(control)  # a second render must stay quiet
        row = _row(data, "grp")
        assert "folder" not in row, row
        messages = [str(w.message) for w in caught]
        assert len(messages) == 1, messages
        assert "'grp'" in messages[0], messages
        assert "a container layer" in messages[0], messages
        assert "root-only" in messages[0], messages

    def test_ignored_container_folder_is_not_claimed(self) -> None:
        group = folium.FeatureGroup(name="grp", foliplus={"folder": "Ops"})
        folium.GeoJson(feature_collection(), name="child").add_to(group)
        m = _map()
        group.add_to(m)
        LayerControl(folders={"overlay": [{"name": "Ops"}]}).add_to(m)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            m.get_root().render()
        messages = [str(w.message) for w in caught]
        # The dropped declaration claims nothing, so the central entry is still
        # "unclaimed" - prove the two reports are independent.
        assert any("no layer declares" in message for message in messages), messages
        assert any("root-only" in message for message in messages), messages

    @pytest.mark.skipif(
        getattr(folium, "LayerGroup", None) is None,
        reason="LayerGroup is a folium >= 1.0.0 group class",
    )
    def test_layer_group_folder_declaration_is_ignored(self) -> None:
        # folium 1.0.0's LayerGroup is a sibling of FeatureGroup and is not a
        # subclass of it; an empty one still renders as a container row.
        group = folium.LayerGroup(name="lg", foliplus={"folder": "Ops"})
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            data = collect_layer_data(_control_with(group))
        row = _row(data, "lg")
        assert "folder" not in row, row
        messages = [str(w.message) for w in caught]
        assert any("a container layer" in message for message in messages), messages

    def test_child_of_a_container_without_a_row_still_warns_once(self) -> None:
        # A layer that lives inside a container is not a root candidate, so it
        # never becomes a row - the ruling still promises "ignored + warned
        # once", so the collection walk must report it from the container side.
        group = folium.FeatureGroup(name="grp")
        folium.GeoJson(
            feature_collection(), name="child", foliplus={"folder": "Ops"}
        ).add_to(group)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            data = collect_layer_data(_control_with(group))
        assert [row["name"] for row in data["data"]] == ["grp"], data
        messages = [str(w.message) for w in caught]
        assert len(messages) == 1, messages
        assert "'child'" in messages[0], messages
        assert "a layer inside a container" in messages[0], messages

    def test_nested_container_and_its_child_are_both_reported(self) -> None:
        # A container inside a container is still a container row; folding it
        # into a folder is "folder 套 group" too, and its own children are
        # "group 套 folder". Both are reported from the container walk.
        outer = folium.FeatureGroup(name="outer")
        inner = folium.FeatureGroup(name="inner", foliplus={"folder": "Ops"})
        inner.add_to(outer)
        folium.GeoJson(
            feature_collection(), name="leaf", foliplus={"folder": "Ops"}
        ).add_to(inner)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            data = collect_layer_data(_control_with(outer))
        assert [row["name"] for row in data["data"]] == ["outer"], data
        messages = [str(w.message) for w in caught]
        assert any(
            "'inner'" in message and "a container layer" in message
            for message in messages
        ), messages
        assert any(
            "'leaf'" in message and "a layer inside a container" in message
            for message in messages
        ), messages

    def test_empty_container_folder_declaration_is_ignored(self) -> None:
        # An empty group still renders as a container row, so its folder
        # declaration would still nest a group inside a folder.
        group = folium.FeatureGroup(name="empty", foliplus={"folder": "Ops"})
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            data = collect_layer_data(_control_with(group))
        row = _row(data, "empty")
        assert "folder" not in row, row
        messages = [str(w.message) for w in caught]
        assert any("a container layer" in message for message in messages), messages

    def test_layer_inside_a_container_declares_no_folder(self) -> None:
        group = folium.FeatureGroup(name="grp")
        layer = folium.GeoJson(
            feature_collection(), name="child", foliplus={"folder": "Ops"}
        )
        layer.add_to(group)
        control = _control_with(group)
        layer.add_to(control._parent)  # also a root candidate, still nested
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            data = collect_layer_data(control)
        child = _row(data, "child")
        assert "folder" not in child, child
        messages = [str(w.message) for w in caught]
        assert any("a layer inside a container" in message for message in messages), (
            messages
        )

    def test_root_layer_folder_is_untouched(self) -> None:
        layer = folium.GeoJson(
            feature_collection(), name="a", foliplus={"folder": "Ops"}
        )
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            row = _row(collect_layer_data(_control_with(layer)), "a")
        assert row["folder"] == "Ops", row
        assert not caught, [str(w.message) for w in caught]


def test_collect_layer_data_warns_on_a_malformed_declaration() -> None:
    layer = folium.GeoJson(feature_collection(), name="a", foliplus={"border": "nope"})
    with pytest.warns(UserWarning):
        collect_layer_data(_control_with(layer))
