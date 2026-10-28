"""Rendering tests for the per-layer author-fill metadata (CONFIG data[].fillAuthor).

The record is Python's: the features' __folium_color plus whichever branca
colormap the author mounted on the map. The tests therefore build both sides —
synthetic features and a real colormap — and assert the shipped payload, not the
internals that produce it.
"""

from __future__ import annotations

import importlib
import json

import branca.colormap as branca_cm
import folium
import pytest

from foliplus import LayerControl

_layer_control_mod = importlib.import_module("foliplus.LayerControl")


def _collection(
    colors: list[str | None],
    *,
    column: str = "score",
    values: list[float] | None = None,
) -> dict:
    features: list[dict] = []
    for i, color in enumerate(colors):
        props: dict[str, object] = {
            column: float(i) if values is None else values[i],
        }
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
    colors: list[str | None],
    *,
    column: str = "score",
    values: list[float] | None = None,
    style: bool = True,
    name: str = "Facility Points",
) -> folium.GeoJson:
    layer = folium.GeoJson(_collection(colors, column=column, values=values), name=name)
    if style:
        layer.style_function = lambda feature: {
            "fillColor": feature["properties"].get("__folium_color", "#3388ff"),
        }
    return layer


def _linear(
    colors: tuple[str, ...] = ("#0d0887", "#f0f921"),
    *,
    vmin: float = 0,
    vmax: float = 100,
    caption: str = "score",
) -> branca_cm.LinearColormap:
    """A continuous scale with the 256-point resolution explore produces."""
    base = branca_cm.LinearColormap(list(colors), vmin=vmin, vmax=vmax)
    # branca emits #rrggbbaa on call and only parses #rrggbb at construction.
    dense = [str(base(vmin + (vmax - vmin) * step / 255))[:7] for step in range(256)]
    return branca_cm.LinearColormap(dense, vmin=vmin, vmax=vmax, caption=caption)


def _stepped(
    colors: tuple[str, ...] = ("#440154", "#3b528b", "#21918c", "#fde725"),
    *,
    index: tuple[float, ...] = (0, 25, 50, 75, 100),
    caption: str = "score",
) -> branca_cm.StepColormap:
    return branca_cm.StepColormap(list(colors), index=list(index), caption=caption)


def _render(*layers: folium.Layer, scales: tuple[object, ...] = ()) -> str:
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    for scale in scales:
        scale.add_to(m)  # type: ignore[attr-defined]
    for layer in layers:
        layer.add_to(m)
    LayerControl().add_to(m)
    return m.get_root().render()


def _conf(html: str) -> dict:
    marker = "CONFIG = "
    start = html.index(marker) + len(marker)
    end = html.index(";", start)
    return json.loads(html[start:end])


def _meta(layer: folium.GeoJson, *scales: object) -> dict:
    html = _render(layer, scales=tuple(scales))
    return _conf(html)["data"][0]["fillAuthor"]


def test_multi_color_layer_carries_the_distinct_colors():
    meta = _meta(_geo(["#0d0887", "#f0f921"]))

    assert meta["perFeature"] is True
    assert meta["distinct"] == 2
    assert meta["stops"] == ["#0d0887", "#f0f921"]
    assert "scale" not in meta


def test_single_color_layer_is_not_per_feature():
    meta = _meta(_geo(["#0d0887", "#0d0887"]))

    assert meta["perFeature"] is False
    assert meta["distinct"] == 1
    assert "scale" not in meta


def test_layer_without_the_property_has_no_fill_author():
    data = _conf(_render(_geo([None, None])))["data"][0]

    assert "fillAuthor" not in data


def test_continuous_scale_is_read_from_the_map():
    scale = _linear()
    values = [10.0, 40.0, 90.0]
    colors = [str(scale(value))[:7] for value in values]
    meta = _meta(_geo(colors, values=values), scale)

    assert meta["scale"]["kind"] == "continuous"
    assert meta["scale"]["column"] == "score"
    assert meta["scale"]["vmin"] == 0
    assert meta["scale"]["vmax"] == 100
    assert len(meta["stops"]) == 64
    assert all(len(stop) == 7 and stop.startswith("#") for stop in meta["stops"])


def test_stepped_scale_ships_the_authors_own_blocks_and_breaks():
    scale = _stepped()
    values = [10.0, 40.0, 90.0]
    colors = [str(scale(value))[:7] for value in values]
    meta = _meta(_geo(colors, values=values), scale)

    assert meta["scale"]["kind"] == "stepped"
    assert meta["scale"]["column"] == "score"
    assert meta["scale"]["levels"] == 4
    assert meta["scale"]["breaks"] == [0, 25, 50, 75, 100]
    assert meta["stops"] == ["#440154", "#3b528b", "#21918c", "#fde725"]
    # JSON-serialisable, not numpy scalars: the CONF block is json.dumps'ed.
    assert all(isinstance(edge, float) for edge in meta["scale"]["breaks"])


def test_a_scale_is_claimed_only_through_its_caption():
    scale = _linear(caption="自定义")
    values = [10.0, 40.0, 90.0]
    colors = [str(scale(value))[:7] for value in values]
    meta = _meta(_geo(colors, values=values), scale)

    # The caption names no property of the layer: no scale is claimed and no
    # column is named. The panel draws the colors the features carry.
    assert "scale" not in meta
    assert meta["perFeature"] is True
    assert meta["stops"] == colors


def test_a_plain_layer_does_not_claim_another_layers_scale():
    scale = _linear(("#440154", "#fde725"), caption="value", vmin=0, vmax=100)
    values = [10.0, 40.0, 90.0]
    explore = _geo(
        [str(scale(value))[:7] for value in values],
        column="value",
        values=values,
        name="Explore",
    )
    # Same property name, other colors, and no scale of its own (a plain
    # legend=False layer): the viridis scale is not its to claim.
    plain = _geo(
        ["#0d0887", "#6a00a8", "#f0f921"],
        column="value",
        values=[1.0, 2.0, 3.0],
        name="Plain",
    )
    html = _render(plain, explore, scales=(scale,))
    data = {entry["name"]: entry for entry in _conf(html)["data"]}

    assert "scale" not in data["Plain"]["fillAuthor"]
    assert data["Explore"]["fillAuthor"]["scale"]["column"] == "value"
    assert "_column" not in data["Plain"]["fillAuthor"]


def test_a_layer_whose_caption_matches_but_colors_do_not_is_not_claimed():
    scale = _linear(("#440154", "#fde725"), caption="value", vmin=0, vmax=100)
    # The layer carries the property the caption names, but its features are
    # painted by something else entirely: a shared property name is not proof.
    meta = _meta(
        _geo(
            ["#0d0887", "#6a00a8", "#f0f921"],
            column="value",
            values=[1.0, 2.0, 3.0],
        ),
        scale,
    )

    assert "scale" not in meta


def test_no_scale_falls_back_to_the_color_set():
    meta = _meta(_geo(["#0d0887", "#6a00a8", "#b12a90"]))

    assert meta["perFeature"] is True
    assert "scale" not in meta
    assert meta["stops"] == ["#0d0887", "#6a00a8", "#b12a90"]


def test_two_layers_sharing_a_caption_keep_their_own_scale():
    first = _linear(("#0d0887", "#f0f921"))
    second = _linear(("#440154", "#fde725"), vmin=0, vmax=100)
    values = [10.0, 40.0, 90.0]
    layer_a = _geo([str(first(value))[:7] for value in values], values=values, name="A")
    layer_b = _geo(
        [str(second(value))[:7] for value in values], values=values, name="B"
    )
    html = _render(layer_a, layer_b, scales=(first, second))
    data = {entry["name"]: entry for entry in _conf(html)["data"]}

    for name in ("A", "B"):
        assert data[name]["fillAuthor"]["scale"]["column"] == "score"
    # The two folds must not collapse onto one scale: the stored strips differ.
    assert data["A"]["fillAuthor"]["stops"] != data["B"]["fillAuthor"]["stops"]


def test_a_scale_does_not_depend_on_the_layer_style_function():
    # explore writes __folium_color AND a style_function; the record reads the
    # property, so a layer that lost the style function keeps its record.
    layer = _geo(["#0d0887", "#f0f921"])
    layer.style_function = None  # type: ignore[assignment]
    meta = _meta(layer)

    assert meta["perFeature"] is True
    assert meta["distinct"] == 2


def test_json_string_data_is_parsed():
    data = json.dumps(_collection(["#0d0887", "#f0f921"]))
    meta = _meta(folium.GeoJson(data))

    assert meta["perFeature"] is True


def test_invalid_json_string_is_ignored():
    layer = _geo(["#0d0887", "#f0f921"])
    # folium parses the data at construction, so the broken payload has to be
    # injected afterwards — the control's own read is what must degrade.
    layer.data = "{not json"
    assert _conf(_render(layer))["data"][0].get("fillAuthor") is None


def test_missing_features_list_is_ignored():
    layer = folium.GeoJson({"type": "FeatureCollection"})
    assert _conf(_render(layer))["data"][0].get("fillAuthor") is None


def test_feature_without_properties_is_skipped():
    layer = _geo(["#0d0887", "#f0f921"])
    layer.data["features"].insert(0, None)
    meta = _meta(layer)

    assert meta["distinct"] == 2


def test_the_color_scan_samples_across_a_sorted_layer(monkeypatch):
    monkeypatch.setattr(_layer_control_mod, "_FILL_AUTHOR_SCAN_LIMIT", 2)
    # A layer sorted by the painted value: a head-only scan would see one class
    # and read the whole layer as a single color.
    meta = _meta(_geo(["#0d0887", "#6a00a8", "#b12a90", "#f0f921"]))

    assert meta["perFeature"] is True
    assert meta["stops"] == ["#0d0887", "#b12a90"]
    assert "capped" not in meta


def test_a_caption_sample_skips_features_without_the_value():
    scale = _linear()
    values = [10.0, 40.0, 90.0]
    colors = [str(scale(value))[:7] for value in values]
    layer = _geo(colors, values=values)
    # A feature missing the caption's property contributes no sample: the
    # agreement is measured on the features that do carry a value.
    del layer.data["features"][1]["properties"]["score"]
    meta = _meta(layer, scale)

    assert meta["scale"]["column"] == "score"


def test_a_caption_sample_skips_values_the_scale_cannot_draw(monkeypatch):
    scale = _linear()
    values = [10.0, 40.0, 90.0]
    rows = [({"score": value}, str(scale(value))[:7]) for value in values]
    original = _layer_control_mod._colormap_sample
    calls = {"count": 0}

    def flaky(colormap: object, value: object) -> str | None:
        calls["count"] += 1
        return None if calls["count"] == 1 else original(colormap, value)

    monkeypatch.setattr(_layer_control_mod, "_colormap_sample", flaky)
    hits, total = _layer_control_mod._column_agreement(scale, rows, "score")

    # One feature could not be sampled: it neither counts nor breaks agreement.
    assert (hits, total) == (2, 2)


def test_a_short_scale_strip_keeps_every_stop():
    scale = branca_cm.LinearColormap(
        ["#0d0887", "#6a00a8", "#f0f921"], vmin=0, vmax=100, caption="score"
    )
    values = [10.0, 40.0, 90.0]
    meta = _meta(
        _geo([str(scale(value))[:7] for value in values], values=values), scale
    )

    # Fewer stops than the strip samples: the strip is the whole palette.
    assert meta["stops"] == ["#0d0887", "#6a00a8", "#f0f921"]


def test_numeric_values_cover_booleans_numpy_integers_and_nan():
    np = pytest.importorskip("numpy")
    numeric = _layer_control_mod._numeric_value

    assert numeric(True) is None
    assert numeric(np.int64(7)) == 7.0
    assert numeric(float("nan")) is None
    assert numeric("7") is None


def test_color_helpers_degrade_on_bad_input():
    module = _layer_control_mod

    assert module._rgb("#12") is None
    assert module._rgb("not-a-color") is None
    # A non-sequence and a channel that is not a float both yield no color
    # instead of raising inside a render.
    assert module._rgba_hex(5) is None
    assert module._rgba_hex("not-a-color") is None
    assert module._rgba_hex([1.0, 2.0]) is None


def test_palette_hex_reads_hex_strings_and_stops():
    module = _layer_control_mod

    assert module._palette_hex("#abc") == "#aabbcc"
    assert module._palette_hex("#AABBCCFF") == "#aabbcc"
    assert module._palette_hex("nope") is None
    assert module._palette_hex((0.0, 0.0, 1.0, 1.0)) == "#0000ff"


def test_author_rows_skips_malformed_and_uncolored_features():
    features = [
        None,
        {"properties": {}},
        *[{"properties": {"__folium_color": "#0d0887"}} for _ in range(6)],
    ]

    rows = _layer_control_mod._author_rows(features)

    assert len(rows) == _layer_control_mod._FILL_AUTHOR_SAMPLE


def test_rgb_reads_short_hex_and_rejects_broken_hex():
    module = _layer_control_mod

    assert module._rgb("#abc") == (170, 187, 204)
    assert module._rgb("#zzzzzz") is None
    assert module._rgb("#12345") is None
    assert module._same_color("nope", "#0d0887") is False


def test_colormap_sample_returns_none_for_a_broken_scale():
    # A scale that raises on call yields no sample instead of a failed render.
    assert _layer_control_mod._colormap_sample(object(), 1.0) is None


def test_pair_scale_needs_a_sampled_color_row():
    scale = _linear()

    assert _layer_control_mod._pair_scale([scale], [{"properties": {}}], set()) is None


def test_a_caption_that_names_a_text_property_claims_nothing():
    scale = _linear(caption="cat")
    values = [10.0, 40.0, 90.0]
    colors = [str(scale(value))[:7] for value in values]
    layer = _geo(colors, values=values)
    for index, feature in enumerate(layer.data["features"]):
        feature["properties"]["cat"] = f"c{index}"
    meta = _meta(layer, scale)

    # The caption is a property, but not a numeric one: no column to claim.
    assert "scale" not in meta


def test_continuous_stops_degrades_for_an_unreadable_index():
    class Scale:
        index = None
        colors = ()

    assert _layer_control_mod._continuous_stops(Scale()) == []


def test_continuous_stops_returns_empty_for_an_empty_index():
    class Scale:
        index = []
        colors = ()

    assert _layer_control_mod._continuous_stops(Scale()) == []


def test_continuous_stops_falls_back_to_interpolation_without_a_palette():
    class Scale:
        index = [0.0, 50.0, 100.0]

        def __call__(self, value: float) -> str:
            if value == 50:
                raise ValueError("no sample")
            return "#0d0887ff" if value < 50 else "#f0f921ff"

    # The middle sample fails: the fallback drops that stop and keeps the rest.
    assert _layer_control_mod._continuous_stops(Scale()) == ["#0d0887", "#f0f921"]


def test_continuous_stops_drops_unreadable_stops():
    class Scale:
        index = [0.0, 50.0, 100.0]
        colors = ["#0d0887", "nope", "#f0f921"]

    assert _layer_control_mod._continuous_stops(Scale()) == ["#0d0887", "#f0f921"]


def test_scale_walk_ignores_nodes_without_children():
    class Node:
        _children = None
        _parent = None

    assert _layer_control_mod._map_colormaps(Node()) == []


def test_scale_payload_without_a_column_omits_it():
    scale = _linear()

    scale_payload, stops = _layer_control_mod._scale_payload(scale, None)

    assert "column" not in scale_payload
    assert len(stops) == 64


def test_a_scale_without_stops_is_not_shipped(monkeypatch):
    scale = _linear()
    values = [10.0, 40.0, 90.0]
    colors = [str(scale(value))[:7] for value in values]
    layer = _geo(colors, values=values)
    monkeypatch.setattr(
        _layer_control_mod,
        "_scale_payload",
        lambda colormap, column: ({"kind": "continuous"}, []),
    )
    meta = _meta(layer, scale)

    assert "scale" not in meta


def test_more_than_the_strip_cap_is_capped(monkeypatch):
    monkeypatch.setattr(_layer_control_mod, "_FILL_AUTHOR_STOPS", 2)
    meta = _meta(_geo(["#0d0887", "#f0f921", "#6a00a8"]))

    assert meta["capped"] is True
    assert len(meta["stops"]) == 2


def test_numpy_backed_values_can_validate_a_caption():
    np = pytest.importorskip("numpy")
    scale = _linear()
    values = [np.float64(10.0), np.float64(40.0), np.float64(90.0)]
    colors = [str(scale(float(value)))[:7] for value in values]
    meta = _meta(_geo(colors, values=[float(v) for v in values]), scale)

    assert meta["scale"]["column"] == "score"


def test_scale_controls_are_reachable_through_a_feature_group():
    # A control attached to a FeatureGroup sits one level below the map; the
    # scale walk must climb, or the declaration is silently lost.
    scale = _linear()
    values = [10.0, 40.0, 90.0]
    layer = _geo([str(scale(value))[:7] for value in values], values=values)

    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    scale.add_to(m)  # type: ignore[attr-defined]
    group = folium.FeatureGroup(name="group")
    layer.add_to(group)
    control = LayerControl()
    group.add_child(control)
    m.add_child(group)
    html = m.get_root().render()
    entry = _conf(html)["data"][0]

    assert entry["fillAuthor"]["scale"]["column"] == "score"


def test_scale_does_not_read_a_map_it_is_not_attached_to():
    scale = _linear()
    values = [10.0, 40.0, 90.0]
    colors = [str(scale(value))[:7] for value in values]
    layer = _geo(colors, values=values)
    # The scale lives on another map entirely: nothing may pair.
    other = folium.Map()
    scale.add_to(other)  # type: ignore[attr-defined]
    html = _render(layer)
    entry = _conf(html)["data"][0]

    assert "scale" not in entry["fillAuthor"]
