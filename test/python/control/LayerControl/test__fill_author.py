"""The fill row: the author's metadata, their colors, and a declared ramp.

Three subjects, one row. Python ships a per-layer record of what the author
painted (explore's per-feature ``__folium_color`` plus whichever branca colormap
was mounted on the map) as ``CONFIG data[].fillAuthor``; the metadata half of
this module builds both sides — synthetic features and a real colormap — and
asserts the shipped payload rather than the internals that produce it.

The browser half drives the row those facts feed: an explore layer opens on a
read-only "Original Colors" mode that the user can leave and return to, and a
``foliplus={"fill": {"field": ...}}`` declaration paints at load, survives Reset
and yields to a later panel edit. Both use the shared fill-row probes and build
their fixtures with folium + branca directly, so explore and geopandas stay out
of CI.
"""

from __future__ import annotations

import importlib
import json

import branca.colormap as branca_cm
import folium
import pytest
from conftest import (
    _js,
    feature_collection,
    load_geojson,
    make_browser_page,
    panel_ready,
    point_feature,
    use_page,
)

from foliplus import LayerControl

# ── browser: the author-colors mode ──
_SCORES = [10.0, 11.0, 12.0, 13.0, 14.0, 15.0]

# Locale text the row must expose as a tooltip instead of a paragraph.
_NOTE = (
    "Colors set per feature by geopandas.GeoDataFrame.explore. "
    "Editing the fill overrides them; Reset restores them."
)
_ORIGINAL = "Original Colors"

# ── browser: the declared ramp ──
_DECLARED_NAME = "Facility Points"
_DECLARED_SCORES = [10, 20, 30, 40, 50, 60]

# ── browser: shared probes ──
# Page snippets live in test/js/browser/LayerControl, the same split the
# menu-keyboard browser test uses: one file to drive the panel, one to read it.
# The mode probe opens the drawer / clicks Reset; pick_scheme presses a palette
# row the way a user does.
_ARM = _js("LayerControl/fill_author_variant")
_READ_FILL = _js("LayerControl/fill_author_read")
_PICK_SCHEME = _js("LayerControl/pick_fill_scheme")
_READ_FILL_METHOD = _js("LayerControl/read_fill_method")
_DECLARED_READ = _js("LayerControl/fill_declared_read")

_layer_control_mod = importlib.import_module(
    "foliplus.control.LayerControl._fill_author"
)


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
        features.append(point_feature(119.30 + i * 0.01, 26.08, props))
    return feature_collection(*features)


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
    # A paired scale's stops are domain order, so the record carries no
    # ordered flag: the bar trusts the shipped order.
    assert "ordered" not in meta["scale"]
    assert meta["scale"]["column"] == "score"
    assert meta["scale"]["vmin"] == 0
    assert meta["scale"]["vmax"] == 100
    assert len(meta["stops"]) == 64
    assert all(len(stop) == 7 and stop.startswith("#") for stop in meta["stops"])
    # A continuous LinearColormap is not a classified scheme, so Python
    # records no provable method: the JS panel states Equal Interval for it
    # as the honest statement that a LinearColormap *is* an interval ramp,
    # not a claim about the author's scheme argument.
    assert meta["scale"]["method"] is None


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
    # The four blocks span equal widths (0-25-50-75-100), so equal-interval
    # is provable from the shipped breaks alone.
    assert meta["scale"]["method"] == "equal"


def test_stepped_scale_with_uneven_breaks_has_no_provable_method():
    # A quantiles/jenks classification produces unequal class widths; the
    # panel must not guess a method for it, so Python records None. The
    # breaks themselves still ship so the panel can state the author's edges.
    index = [0.0, 10.0, 30.0, 60.0, 100.0]
    colormap = branca_cm.StepColormap(
        ["#440154", "#3b528b", "#21918c", "#fde725"], index=index
    )
    scale_payload, _ = _layer_control_mod.scale_payload(colormap, "score")

    assert scale_payload["kind"] == "stepped"
    assert scale_payload["breaks"] == index
    assert scale_payload["method"] is None


def test_provable_equal_interval_is_math_only():
    provable = _layer_control_mod.provable_equal_interval
    # The helper is private; call it through the module so the rename rule
    # (module-internal names carry no underscore) keeps working.
    # Too few edges to have two intervals: no method either way.
    assert provable([]) is False
    assert provable([0.0]) is False
    assert provable([0.0, 50.0]) is False
    # Degenerate / descending edges are not a classification.
    assert provable([0.0, 25.0, 25.0, 100.0]) is False
    assert provable([100.0, 75.0, 50.0, 25.0, 0.0]) is False
    # Equally spaced: provable, including a non-integer step (float division
    # leaves a rounding hair, so the comparison tolerates it).
    assert provable([0.0, 33.333333333, 66.666666666, 100.0]) is True
    # Uneven: never provable.
    assert provable([0.0, 10.0, 30.0, 60.0, 100.0]) is False


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
    layer = folium.GeoJson(feature_collection())
    assert _conf(_render(layer))["data"][0].get("fillAuthor") is None


def test_feature_without_properties_is_skipped():
    layer = _geo(["#0d0887", "#f0f921"])
    layer.data["features"].insert(0, None)
    meta = _meta(layer)

    assert meta["distinct"] == 2


def test_the_color_scan_samples_across_a_sorted_layer(monkeypatch):
    monkeypatch.setattr(_layer_control_mod, "FILL_AUTHOR_SCAN_LIMIT", 2)
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
    original = _layer_control_mod.colormap_sample
    calls = {"count": 0}

    def flaky(colormap: object, value: object) -> str | None:
        calls["count"] += 1
        return None if calls["count"] == 1 else original(colormap, value)

    monkeypatch.setattr(_layer_control_mod, "colormap_sample", flaky)
    hits, total = _layer_control_mod.column_agreement(scale, rows, "score")

    # One feature could not be sampled: it neither counts nor breaks agreement.
    assert (hits, total) == (2, 2)


def test_stepped_agreement_skips_rows_without_the_column_value():
    scale = _stepped()
    rows = [
        ({"score": 10.0}, "#440154"),
        ({"name": "no score"}, "#3b528b"),
        ({"score": 90.0}, "#fde725"),
    ]
    hits, total = _layer_control_mod.stepped_agreement(scale, rows, "score")

    # The feature without a numeric value contributes no sample: it neither
    # counts in the denominator nor can it hit a block. Membership is measured
    # on the rows that do carry the column.
    assert (hits, total) == (2, 2)


def test_stepped_agreement_counts_every_row_when_all_have_the_value():
    scale = _stepped()
    rows = [
        ({"score": 10.0}, "#440154"),
        ({"score": 50.0}, "#21918c"),
        ({"score": 90.0}, "#fde725"),
    ]
    hits, total = _layer_control_mod.stepped_agreement(scale, rows, "score")

    assert (hits, total) == (3, 3)


def test_a_stepped_scale_missing_a_value_still_measures_the_rest():
    scale = _stepped()
    values = [10.0, 40.0, 90.0]
    colors = ["#440154", "#3b528b", "#fde725"]
    layer = _geo(colors, values=values)
    del layer.data["features"][1]["properties"]["score"]

    meta = _meta(layer, scale)

    # The missing-value feature is skipped, not a veto: the two remaining
    # features both carry the scale's own blocks.
    assert meta["scale"]["column"] == "score"
    assert meta["stops"] == ["#440154", "#3b528b", "#21918c", "#fde725"]


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
    numeric = _layer_control_mod.numeric_value

    assert numeric(True) is None
    assert numeric(np.int64(7)) == 7.0
    assert numeric(float("nan")) is None
    assert numeric("7") is None


def test_color_helpers_degrade_on_bad_input():
    module = _layer_control_mod

    assert module.rgb("#12") is None
    assert module.rgb("not-a-color") is None
    # A non-sequence and a channel that is not a float both yield no color
    # instead of raising inside a render.
    assert module.rgba_hex(5) is None
    assert module.rgba_hex("not-a-color") is None
    assert module.rgba_hex([1.0, 2.0]) is None


def test_palette_hex_reads_hex_strings_and_stops():
    module = _layer_control_mod

    assert module.palette_hex("#abc") == "#aabbcc"
    assert module.palette_hex("#AABBCCFF") == "#aabbcc"
    assert module.palette_hex("nope") is None
    assert module.palette_hex((0.0, 0.0, 1.0, 1.0)) == "#0000ff"


def test_author_rows_skips_malformed_and_uncolored_features():
    features = [
        None,
        {"properties": {}},
        *[{"properties": {"__folium_color": "#0d0887"}} for _ in range(20)],
    ]

    rows = _layer_control_mod.author_rows(features)

    assert len(rows) == _layer_control_mod.FILL_AUTHOR_SAMPLE
    assert all(color == "#0d0887" for _, color in rows)


def test_rgb_reads_short_hex_and_rejects_broken_hex():
    module = _layer_control_mod

    assert module.rgb("#abc") == (170, 187, 204)
    assert module.rgb("#zzzzzz") is None
    assert module.rgb("#12345") is None
    assert module.same_color("nope", "#0d0887") is False


def test_colormap_sample_returns_none_for_a_broken_scale():
    # A scale that raises on call yields no sample instead of a failed render.
    assert _layer_control_mod.colormap_sample(object(), 1.0) is None


def test_pair_scale_needs_a_sampled_color_row():
    scale = _linear()

    assert _layer_control_mod.pair_scale([scale], [{"properties": {}}], set()) is None


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

    assert _layer_control_mod.continuous_stops(Scale()) == []


def test_continuous_stops_returns_empty_for_an_empty_index():
    class Scale:
        index = []
        colors = ()

    assert _layer_control_mod.continuous_stops(Scale()) == []


def test_continuous_stops_falls_back_to_interpolation_without_a_palette():
    class Scale:
        index = [0.0, 50.0, 100.0]

        def __call__(self, value: float) -> str:
            if value == 50:
                raise ValueError("no sample")
            return "#0d0887ff" if value < 50 else "#f0f921ff"

    # The middle sample fails: the fallback drops that stop and keeps the rest.
    assert _layer_control_mod.continuous_stops(Scale()) == ["#0d0887", "#f0f921"]


def test_continuous_stops_drops_unreadable_stops():
    class Scale:
        index = [0.0, 50.0, 100.0]
        colors = ["#0d0887", "nope", "#f0f921"]

    assert _layer_control_mod.continuous_stops(Scale()) == ["#0d0887", "#f0f921"]


def test_scale_walk_ignores_nodes_without_children():
    class Node:
        _children = None
        _parent = None

    assert _layer_control_mod.map_colormaps(Node()) == []


def test_scale_payload_without_a_column_omits_it():
    scale = _linear()

    scale_payload, stops = _layer_control_mod.scale_payload(scale, None)

    assert "column" not in scale_payload
    assert len(stops) == 64


def test_a_scale_without_stops_is_not_shipped(monkeypatch):
    scale = _linear()
    values = [10.0, 40.0, 90.0]
    colors = [str(scale(value))[:7] for value in values]
    layer = _geo(colors, values=values)
    monkeypatch.setattr(
        _layer_control_mod,
        "scale_payload",
        lambda colormap, column: ({"kind": "continuous"}, []),
    )
    meta = _meta(layer, scale)

    assert "scale" not in meta


def test_more_than_the_strip_cap_is_capped(monkeypatch):
    monkeypatch.setattr(_layer_control_mod, "FILL_AUTHOR_STOPS", 2)
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


def test_a_missing_value_in_the_first_feature_does_not_drop_the_scale():
    scale = _linear()
    values = [float("nan"), 40.0, 90.0]
    colors = ["lightgrey", *(str(scale(value))[:7] for value in values[1:])]
    # missing_kwds paints the NaN feature, so the sample opens on a row the
    # scale cannot sample. The caption still names the layer's column: one
    # missing value must not cost the whole layer its scale (it did before the
    # caption check looked past the first sampled row).
    meta = _meta(_geo(colors, values=values), scale)

    assert meta["scale"]["kind"] == "continuous"
    assert meta["scale"]["column"] == "score"
    assert len(meta["stops"]) == 64


def test_a_stepped_scale_accepts_its_own_blocks_across_a_bin_edge():
    scale = _stepped()
    # Every feature sits in the first class, but the layer paints them with all
    # four blocks: mapclassify's bin edges do exactly this on a fisherjenks
    # layer, and a probability bar over-rejected it. Membership in the author's
    # block set is the exact test a classified scale deserves.
    blocks = [str(scale(value))[:7] for value in (10.0, 30.0, 60.0, 90.0)]
    colors = blocks * 3
    meta = _meta(_geo(colors, values=[20.0] * len(colors)), scale)

    assert meta["scale"]["kind"] == "stepped"
    assert meta["scale"]["column"] == "score"
    assert meta["scale"]["levels"] == 4
    assert meta["scale"]["breaks"] == [0, 25, 50, 75, 100]


def test_a_stepped_scale_is_refused_when_a_color_is_not_one_of_its_blocks():
    scale = _stepped()
    # Same property name, other palette: no block of this scale paints them.
    colors = ["#0d0887", "#6a00a8", "#b12a90", "#f0f921", "#0d0887", "#6a00a8"]
    meta = _meta(_geo(colors, values=[20.0] * len(colors)), scale)

    assert "scale" not in meta


def test_a_refused_stepped_caption_reports_block_membership(caplog):
    # The stepped variant tests exact block membership, so the refusal message
    # must name it: features carry none of this scale's blocks.
    scale = _stepped(caption="membership_probe")
    colors = ["#0d0887", "#6a00a8", "#b12a90", "#f0f921", "#0d0887", "#6a00a8"]
    with caplog.at_level("WARNING", logger="foliplus.control.LayerControl"):
        _meta(
            _geo(colors, column="membership_probe", values=[20.0] * len(colors)),
            scale,
        )

    assert "carry one of its blocks" in caplog.text
    assert "match its colors" not in caplog.text


def test_a_refused_continuous_caption_reports_color_match(caplog):
    # The continuous variant tests the color-match ratio, so the refusal message
    # must name that instead of block membership.
    scale = _linear(
        ("#440154", "#fde725"), caption="color_match_probe", vmin=0, vmax=100
    )
    colors = ["#0d0887", "#6a00a8", "#f0f921"]
    with caplog.at_level("WARNING", logger="foliplus.control.LayerControl"):
        _meta(
            _geo(colors, column="color_match_probe", values=[1.0, 2.0, 3.0]),
            scale,
        )

    assert "match its colors" in caplog.text
    assert "carry one of its blocks" not in caplog.text


def test_affine_equivalent_columns_are_claimed_by_render_order():
    scale = _linear(("#440154", "#fde725"), caption="score", vmin=0, vmax=100)
    values = [10.0, 40.0, 90.0]
    explore = _geo(
        [str(scale(value))[:7] for value in values], values=values, name="Explore"
    )
    # The plain layer paints an affine column (value = 3 * score + 10, the
    # area / area_ha case): the colors are identical at every stop, so no color
    # check can tell the two columns apart. Documented limitation, pinned here
    # so it is not mistaken for a regression later: the first caption in render
    # order keeps the scale, and the real owning layer ships colors only.
    plain = _geo(
        [str(scale(value))[:7] for value in values],
        column="value",
        values=[3.0 * value + 10.0 for value in values],
        name="Plain",
    )
    for feature, value in zip(plain.data["features"], values):
        feature["properties"]["score"] = value
    html = _render(plain, explore, scales=(scale,))
    data = {entry["name"]: entry for entry in _conf(html)["data"]}

    assert data["Plain"]["fillAuthor"]["scale"]["column"] == "score"
    assert "scale" not in data["Explore"]["fillAuthor"]


@pytest.mark.parametrize("k", [7, 8, 9])
def test_a_fisherjenks_caption_survives_the_bin_edges(k):
    np = pytest.importorskip("numpy")
    gpd = pytest.importorskip("geopandas")
    pytest.importorskip("mapclassify")
    # The dataset echo measured: fisherjenks k >= 7 put 3 of the 5 sampled
    # features on the far side of a bin edge, and the majority bar refused a
    # correctly captioned scale. Every block color is still the author's.
    rng = np.random.default_rng(16)
    score = np.round(rng.uniform(0, 100, 43), 4)
    frame = gpd.GeoDataFrame(
        {"score": score},
        geometry=gpd.points_from_xy(range(43), [x * 0.5 for x in range(43)]),
    )
    m = folium.Map()
    frame.explore(m=m, column="score", scheme="fisherjenks", k=k, name="A")
    layer = [v for v in m._children.values() if type(v).__name__ == "GeoJson"][0]
    scales = [
        v
        for v in m._children.values()
        if type(v).__name__ in ("LinearColormap", "StepColormap")
    ]
    payload = _layer_control_mod.fill_author(layer, scales, set())

    assert payload["scale"]["kind"] == "stepped"
    assert payload["scale"]["column"] == "score"
    assert payload["scale"]["levels"] == k
    assert all(isinstance(edge, float) for edge in payload["scale"]["breaks"])


def test_no_scale_many_distinct_colors_reads_as_continuous():
    # A legend=False explore layer mounts no colormap, so no scale pairs. A
    # per-feature layer painting more distinct colors than the panel's 9-class
    # maximum is read as a continuous ramp: ship a {kind: continuous} so the
    # panel states Equal Interval (the honest statement that a LinearColormap
    # is an interval ramp). stops stay the sampled strip in feature-discovery
    # order, so the record marks it "ordered": False — only a paired scale's
    # stops are domain order, and the bar must sort a discovery-order strip
    # (by lightness) instead of trusting it. column / vmin / vmax / method are
    # deliberately NOT written — a guess at the drive column and extent would
    # be worse than none.
    colors = ["#%06x" % (i * 0x111111) for i in range(12)]
    meta = _meta(_geo(colors))

    assert meta["perFeature"] is True
    assert meta["distinct"] == 12
    assert meta["scale"] == {"kind": "continuous", "ordered": False}
    assert "column" not in meta["scale"]
    assert "vmin" not in meta["scale"]
    assert "vmax" not in meta["scale"]
    assert "method" not in meta["scale"]
    # The sampled strip stays the author's colors.
    assert meta["stops"] == colors


def test_no_scale_at_the_continuous_threshold_boundary():
    # 9 distinct colors = the panel's class maximum (CLASS_COUNT.MAX): a
    # small-step classification the panel can still describe from its own
    # colors, so no continuous scale is synthesized (the method box shows a
    # dash). 10 distinct crosses the threshold and reads as continuous.
    nine = ["#%06x" % (i * 0x111111) for i in range(9)]
    assert "scale" not in _meta(_geo(nine))
    ten = ["#%06x" % (i * 0x111111) for i in range(10)]
    assert _meta(_geo(ten))["scale"] == {"kind": "continuous", "ordered": False}


def test_real_scale_high_cardinality_still_pairs():
    # A real linear scale (legend=True) paired with a >9-distinct layer keeps
    # the paired path: column / vmin / vmax ship, and the synthesized-scale
    # branch does not fire (a real scale is the author's own declaration).
    scale = _linear()
    values = [float(i) for i in range(12)]
    colors = [str(scale(value))[:7] for value in values]
    meta = _meta(_geo(colors, values=values), scale)

    assert meta["scale"]["kind"] == "continuous"
    # Paired path: a real scale is the author's own declaration, its stops are
    # domain order, so no ordered flag is written.
    assert "ordered" not in meta["scale"]
    assert meta["scale"]["column"] == "score"
    assert meta["scale"]["vmin"] == 0
    assert meta["scale"]["vmax"] == 100
    assert meta["scale"]["method"] is None


def _scale() -> branca_cm.LinearColormap:
    """A continuous scale with the 256-point resolution explore produces."""
    base = branca_cm.LinearColormap(["#0d0887", "#f0f921"], vmin=10, vmax=15)
    dense = [str(base(10 + 5 * step / 255))[:7] for step in range(256)]
    return branca_cm.LinearColormap(dense, vmin=10, vmax=15, caption="score")


def _layer(scale: branca_cm.LinearColormap) -> folium.GeoJson:
    colors = [str(scale(score))[:7] for score in _SCORES]
    data = load_geojson("common", "polygons_fuzhou_6offset")
    for i, (feat, color, score) in enumerate(
        zip(data["features"], colors, _SCORES, strict=True)
    ):
        feat["properties"] = {"__folium_color": color, "cat": f"c{i}", "score": score}
    return folium.GeoJson(
        json.dumps(data),
        name="Facility Points",
        style_function=lambda f: {
            "fillColor": f["properties"]["__folium_color"],
            "fillOpacity": 0.8,
            "color": "none",
        },
    )


def _make_author_page(browser, tmp_path):
    scale = _scale()
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    scale.add_to(m)
    _layer(scale).add_to(m)
    LayerControl(locale="en").add_to(m)
    return make_browser_page(browser, tmp_path, m.get_root().render(), "fill_author")


def _open_author_style_panel(page):
    """Open the row's style drawer: the more menu, then the style entry."""
    page.evaluate(_js("LayerControl/open_panel"))
    opened = page.evaluate(_ARM)
    assert opened["ok"], f"style panel did not open: {opened}"
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible", timeout=5000)


class TestFillAuthorBrowser:
    """An explore layer opens on its original colors and can come back to them."""

    def test_original_colors_override_and_reset(self, browser, tmp_path):
        with use_page(_make_author_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-layer-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            _open_author_style_panel(page)

            # The read-only original-colors mode: the scale's column, the
            # author's colors in author order and their count, and none of the
            # classification controls. The map still shows the author's paint.
            initial = page.evaluate(_READ_FILL)
            assert initial["mode"] == "original", initial
            assert initial["originalAvailable"] is True, initial
            assert initial["originalDisabled"] is False, initial
            assert initial["originalLabel"] == _ORIGINAL, initial
            assert initial["note"] == _NOTE, initial
            assert initial["column"] == "score", initial
            assert initial["count"] == "—", initial
            # A continuous scale is the default explore mapping (an equally
            # spaced LinearColormap): the method readout states Equal Interval.
            assert initial["method"] == "Equal Interval", initial
            # The method and count share one row (the by-value classes row's
            # shape): the method readout fills the control column from its left
            # edge, the count readout hugs the right edge at the compact
            # secondary width, and both values are centered.
            m = initial["methodGeom"]
            c = initial["countGeom"]
            k = initial["colorsGeom"]
            assert m is not None and c is not None and k is not None, initial
            # Classification Method starts at the control column's left edge and ends where the
            # count begins (side by side in one inline row).
            assert m["left"] == k["left"], initial
            assert c["left"] >= m["right"], initial
            assert c["right"] == k["right"], initial
            assert c["width"] == initial["secondaryWidth"], (
                f"count width {c['width']} != secondary {initial['secondaryWidth']}: {initial}"
            )
            # The count value is centered by the stylesheet (style.css rule
            # .foliplus-style-fill-original-count .foliplus-style-fill-original-value
            # { text-align: center }), read here via getComputedStyle because the
            # inline style is always empty. Negative control: deleting that
            # text-align line turns this assertion red on the browser job —
            # do not weaken it to read the inline style.
            assert initial["methodTextAlign"] == "center", initial
            assert initial["countTextAlign"] == "center", initial
            # The value span is a flex child: text-align only centers once the
            # span fills the box (flex:1, min-width:0). Measure the real glyph
            # position against the box — computed text-align alone would not
            # catch a content-width span. Negative control: removing flex:1
            # from either value rule must turn this red on the browser job.
            assert initial["methodTextDeviation"] is not None, initial
            assert initial["methodTextDeviation"] <= 2, initial
            assert initial["countTextDeviation"] is not None, initial
            assert initial["countTextDeviation"] <= 2, initial
            # The two readouts stay distinguishable to assistive tech, the same
            # split the by-value classes row keeps for its two selects. The
            # name rides on role="group": a bare div exposes the aria-label in
            # Chromium but that is not dependable across AT/browsers (and
            # "text" is not an ARIA role — it is a Safari/WebKit-ism).
            assert initial["methodRole"] == "group", initial
            assert initial["countRole"] == "group", initial
            assert initial["colorsRole"] == "img", initial
            assert initial["methodAria"] == "Classification Method", initial
            assert initial["countAria"] == "Classes", initial
            assert initial["caption"] == "Original · continuous", initial
            assert initial["colorsLabel"] == "Original · continuous", initial
            assert initial["gradient"].startswith("linear-gradient(90deg,"), initial
            # A continuous scale is sampled down to a readable number of stops
            # instead of one DOM block per color.
            assert 2 <= initial["stops"] <= 12, initial
            # The read-only detail holds nothing to operate.
            assert initial["detailSelects"] == 0, initial
            assert initial["detailComboboxes"] == 0, initial
            assert initial["detailFocusable"] == 0, initial
            assert len(initial["rows"]) == 3, initial
            assert all("foliplus-form-row" in row for row in initial["rows"]), initial
            assert initial["hasField"] is False, initial
            assert initial["hasMethod"] is False, initial
            assert initial["hasClasses"] is False, initial
            assert initial["hasScheme"] is False, initial
            assert initial["hasSwatch"] is False, initial
            assert initial["noteInPanel"] is False, initial
            assert len(initial["fills"]) >= 2, (
                f"the map did not paint per-feature author colors: {initial}"
            )

            # Activating the mode it is already in writes nothing and repaints
            # nothing: it is a stored choice, not a state change.
            page.evaluate(_ARM, {"original": True})
            page.wait_for_timeout(300)
            unchanged = page.evaluate(_READ_FILL)
            assert unchanged["mode"] == "original", unchanged
            assert unchanged["fills"] == initial["fills"], (
                f"activating the original-colors mode repainted the map: {unchanged}"
            )

            # Choosing the solid mode takes the fill over with one color.
            solid_result = page.evaluate(_ARM, {"solid": True})
            assert solid_result["ok"], f"solid switch failed: {solid_result}"
            page.wait_for_timeout(300)
            taken = page.evaluate(_READ_FILL)
            assert taken["mode"] == "solid", taken
            assert taken["hasSwatch"] is True, taken
            assert len(taken["fills"]) == 1, (
                f"the solid mode did not repaint the map: {taken}"
            )
            assert taken["fills"] != initial["fills"], taken

            # The mode is offered again — the stored state, not a one-way door —
            # and picking it puts the author's own colors back on the map.
            assert taken["originalAvailable"] is True, taken
            page.evaluate(_ARM, {"original": True})
            page.wait_for_timeout(300)
            back = page.evaluate(_READ_FILL)
            assert back["mode"] == "original", back
            assert back["fills"] == initial["fills"], (
                f"the original-colors mode did not restore the author colors: {back}"
            )
            assert back["hasSwatch"] is False, back

            # Reset returns the same state from the other direction.
            page.evaluate(_ARM, {"solid": True})
            page.wait_for_timeout(300)
            page.evaluate(_ARM, {"reset": True})
            page.wait_for_timeout(300)
            _open_author_style_panel(page)
            restored = page.evaluate(_READ_FILL)
            assert restored["mode"] == "original", restored
            assert restored["fills"] == initial["fills"], (
                f"Reset did not restore the author colors: {restored}"
            )
            assert not errors, f"JS errors: {errors}"

    @pytest.mark.parametrize("width", [380, 480, 768, 1000])
    def test_read_only_rows_fit_every_viewport(self, browser, tmp_path, width):
        """The read-only rows fit the panel at every viewport, 380px included.

        The panel has its own width, but the control column is resolved from
        the viewport: the rows must not overflow it at any of the widths the
        user's screenshots came from.
        """
        with use_page(_make_author_page, browser, tmp_path) as (page, errors):
            page.set_viewport_size({"width": width, "height": 900})
            page.wait_for_selector(
                ".foliplus-layer-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            _open_author_style_panel(page)

            read = page.evaluate(_READ_FILL)
            assert read["mode"] == "original", read
            assert read["panelScroll"] <= 0, (width, read)
            assert read["boxRightMax"] <= read["panelRight"], (width, read)
            assert read["stops"] >= 2, (width, read)
            assert not errors, f"JS errors: {errors}"

    def test_continuous_band_without_a_scale_states_equal_interval(
        self, browser, tmp_path
    ):
        """A legend=False layer painting >9 distinct colors is read as a
        continuous ramp: the original-colors mode states Equal Interval, the
        honest statement that a LinearColormap is an interval ramp — not a
        dash, and not a guessed classification.
        """
        colors = ["#%06x" % (i * 0x111111) for i in range(12)]
        data = load_geojson("common", "polygons_fuzhou_12offset")
        for i, (feat, color) in enumerate(zip(data["features"], colors, strict=True)):
            feat["properties"] = {"__folium_color": color, "score": float(i)}
        layer = folium.GeoJson(
            json.dumps(data),
            name="Facility Points",
            style_function=lambda f: {
                "fillColor": f["properties"]["__folium_color"],
                "fillOpacity": 0.8,
                "color": "none",
            },
        )
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        layer.add_to(m)
        LayerControl(locale="en").add_to(m)
        page, errors = make_browser_page(
            browser, tmp_path, m.get_root().render(), "fill_continuous_band"
        )
        page.wait_for_selector(
            ".foliplus-layer-ctrl .foliplus-toggle-btn",
            state="attached",
            timeout=10000,
        )
        page.evaluate(_js("LayerControl/open_panel"))
        page.wait_for_selector(
            ".foliplus-layer-ctrl.foliplus-is-expanded",
            state="attached",
            timeout=5000,
        )
        panel_ready(page)
        _open_author_style_panel(page)

        state = page.evaluate(_READ_FILL)
        assert state["mode"] == "original", state
        assert state["method"] == "Equal Interval", state
        # The map paints the author's 10+ distinct colors, not a synthetic
        # 9-class ramp: the >9 threshold is exactly what the inference is about.
        assert len(state["fills"]) >= 10, state
        assert not errors, f"JS errors: {errors}"


def _declared_layer() -> folium.GeoJson:
    data = load_geojson("common", "polygons_fuzhou_6offset")
    for feat, score in zip(data["features"], _DECLARED_SCORES, strict=True):
        feat["properties"] = {"score": score}
    return folium.GeoJson(
        json.dumps(data),
        name=_DECLARED_NAME,
        style_function=lambda _feature: {
            "fillColor": "#808080",
            "fillOpacity": 0.8,
            "color": "none",
        },
        foliplus={
            "fill": {
                "field": "score",
                "scheme": "Reds",
                "method": "equal",
                "classes": 3,
            }
        },
    )


def _make_declared_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    _declared_layer().add_to(m)
    LayerControl(locale="en").add_to(m)
    return make_browser_page(browser, tmp_path, m.get_root().render(), "declared_fill")


def _open_declared_style_panel(page) -> None:
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded",
        state="attached",
        timeout=5000,
    )
    panel_ready(page)
    opened = page.evaluate(_ARM)
    assert opened["ok"], f"style panel did not open: {opened}"
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible", timeout=5000)


class TestDeclaredFillBrowser:
    """The declaration paints at load, survives Reset and yields to the user."""

    def test_declared_ramp_paints_at_load_and_resets_to_declaration(
        self, browser, tmp_path
    ):
        with use_page(_make_declared_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-layer-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            # The declaration is a read-time default: the map must be painted
            # by value before the user touches the panel. The row itself is not
            # open yet, so only the painted colors are readable here.
            before_panel = page.evaluate(_DECLARED_READ)
            assert len(before_panel["fills"]) >= 2, (
                f"the declared ramp did not reach the map at load: {before_panel}"
            )
            assert "#808080" not in before_panel["fills"], (
                f"the map kept the author's flat fill: {before_panel}"
            )

            _open_declared_style_panel(page)
            initial = page.evaluate(_DECLARED_READ)
            assert initial["mode"] == "value", initial
            assert initial["originalAvailable"] is False, initial
            assert initial["hasSwatch"] is False, initial
            assert initial["field"] == "score", initial
            assert initial["classes"] == "3", initial
            assert initial["schemeTitle"] == "Reds", initial
            assert initial["fills"] == before_panel["fills"], initial
            # The method key is the fifth declared control: the by-value mode
            # states the declared classification, not a guess.
            method = page.evaluate(_READ_FILL_METHOD)
            assert method == {"value": "equal", "label": "Equal Interval"}, method

            # A panel edit is the user's intent: it repaints the map and the
            # row now reads the user's scheme.
            scheme = page.evaluate(_PICK_SCHEME, {"scheme": "Blues"})
            assert scheme["ok"], f"scheme pick failed: {scheme}"
            page.wait_for_timeout(300)
            taken = page.evaluate(_DECLARED_READ)
            assert taken["schemeTitle"] == "Blues", taken
            assert taken["fills"] != initial["fills"], (
                f"choosing a scheme did not repaint the map: {taken}"
            )

            # Reset clears the user's intent, so the declaration shows through
            # again — the declared scheme and the declared paint, not the
            # author's flat color.
            page.evaluate(_ARM, {"reset": True})
            page.wait_for_timeout(300)
            _open_declared_style_panel(page)
            restored = page.evaluate(_DECLARED_READ)
            assert restored["mode"] == "value", restored
            assert restored["field"] == "score", restored
            assert restored["classes"] == "3", restored
            assert restored["schemeTitle"] == "Reds", restored
            assert restored["fills"] == initial["fills"], (
                f"Reset did not restore the declared ramp: {restored}"
            )
            # Reset restores the declared method too — the read-only by-value
            # mode comes back to the author's classification, not a guess.
            restored_method = page.evaluate(_READ_FILL_METHOD)
            # Reset may drop the drawer (the element can be absent), so do not
            # assume the probe always returns an object.
            assert restored_method is not None, restored_method
            assert restored_method["value"] == "equal", restored_method

            # The user's choice wins across a reload; the declaration is still
            # what Reset would return to.
            page.evaluate(_PICK_SCHEME, {"scheme": "Blues"})
            page.wait_for_timeout(300)
            page.reload()
            page.wait_for_selector(
                ".foliplus-layer-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            _open_declared_style_panel(page)
            reloaded = page.evaluate(_DECLARED_READ)
            assert reloaded["schemeTitle"] == "Blues", reloaded
            assert reloaded["mode"] == "value", reloaded

            assert not errors, f"JS errors: {errors}"
