"""Split of test__fill_author.py by dimension."""

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

_SCORES = [10.0, 11.0, 12.0, 13.0, 14.0, 15.0]

_NOTE = (
    "Colors set per feature by geopandas.GeoDataFrame.explore. "
    "Editing the fill overrides them; Reset restores them."
)

_ORIGINAL = "Original Colors"

_DECLARED_NAME = "Facility Points"

_DECLARED_SCORES = [10, 20, 30, 40, 50, 60]

_ARM = _js("LayerControl/fill_author_variant")

_READ_FILL = _js("LayerControl/fill_author_read")

_PARITY = _js("LayerControl/control_inset_parity")

_PICK_SCHEME = _js("LayerControl/pick_fill_scheme")

_READ_FILL_METHOD = _js("LayerControl/read_fill_method")

_DECLARED_READ = _js("LayerControl/fill_declared_read")

_layer_control_mod = importlib.import_module(
    "foliplus.control.LayerControl._fill_author"
)

_scale_mod = importlib.import_module("foliplus.control.LayerControl._fill_author.scale")

_colormap_mod = importlib.import_module(
    "foliplus.control.LayerControl._fill_author.colormap"
)

_payload_mod = importlib.import_module(
    "foliplus.control.LayerControl._fill_author.payload"
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


def test_multi_color_layer_carries_the_distinct_colors():
    meta = _meta(_geo(["#0d0887", "#f0f921"]))

    assert meta["perFeature"] is True
    assert meta["distinct"] == 2
    assert meta["stops"] == ["#0d0887", "#f0f921"]
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


def test_the_color_scan_samples_across_a_sorted_layer(monkeypatch):
    monkeypatch.setattr(_scale_mod, "FILL_AUTHOR_SCAN_LIMIT", 2)
    # A layer sorted by the painted value: a head-only scan would see one class
    # and read the whole layer as a single color.
    meta = _meta(_geo(["#0d0887", "#6a00a8", "#b12a90", "#f0f921"]))

    assert meta["perFeature"] is True
    assert meta["stops"] == ["#0d0887", "#b12a90"]
    assert "capped" not in meta


def test_a_caption_sample_skips_values_the_scale_cannot_draw(monkeypatch):
    scale = _linear()
    values = [10.0, 40.0, 90.0]
    rows = [({"score": value}, str(scale(value))[:7]) for value in values]
    original = _colormap_mod.colormap_sample
    calls = {"count": 0}

    def flaky(colormap: object, value: object) -> str | None:
        calls["count"] += 1
        return None if calls["count"] == 1 else original(colormap, value)

    monkeypatch.setattr(_colormap_mod, "colormap_sample", flaky)
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


def test_a_scale_without_stops_is_not_shipped(monkeypatch):
    scale = _linear()
    values = [10.0, 40.0, 90.0]
    colors = [str(scale(value))[:7] for value in values]
    layer = _geo(colors, values=values)
    monkeypatch.setattr(
        _payload_mod,
        "scale_payload",
        lambda colormap, column: ({"kind": "continuous"}, []),
    )
    meta = _meta(layer, scale)

    assert "scale" not in meta


def test_more_than_the_strip_cap_is_capped(monkeypatch):
    monkeypatch.setattr(_scale_mod, "FILL_AUTHOR_STOPS", 2)
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
