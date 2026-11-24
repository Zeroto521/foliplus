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


class TestFillAuthorBrowser:
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
            # Four rows in the cmap original detail: the field (column),
            # the method+count pair, the scheme, and the read-only opacity
            # row the fill-opacity-modes spec adds (after the scheme, before
            # the border mode). The opacity row is a read-out, never a control.
            assert len(initial["rows"]) == 4, initial
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

    def test_control_inset_text_start_parity(self, browser, tmp_path):
        """The Method control column's text starts at the same x in both modes.

        The readonly box (original colors) and the dropdown trigger (by-value)
        replace each other in the same row slot; both resolve their left inset
        from .foliplus-input-skin's single --foliplus-ctrl-inset-x. A second
        left-inset source (a per-control literal padding, or the select
        declaring its own left padding) re-misaligns the column the moment the
        token is edited. The probe measures both modes in place (the mode
        select rebuilds the detail slot, row x stays constant).
        """
        with use_page(_make_author_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-layer-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            page.evaluate(_js("LayerControl/open_panel"))
            panel_ready(page)
            _open_author_style_panel(page)

            # Original mode: the method readout box.
            original = page.evaluate(_PARITY, {"mode": "original"})
            assert original["ok"], original
            assert original["mode"] == "original", original
            assert original["kind"] == "box", original
            assert original["present"] is True, original

            # Value mode: the method dropdown trigger in the same row slot.
            value = page.evaluate(_PARITY, {"mode": "value"})
            assert value["ok"], value
            assert value["mode"] == "value", value
            assert value["kind"] == "trigger", value
            assert value["present"] is True, value

            # Both are left-aligned controls in the same slot; the text-start
            # (box left + its padding-left) must match the trigger's within 1px.
            assert original["textStart"] is not None, original
            assert value["textStart"] is not None, value
            diff = abs(original["textStart"] - value["textStart"])
            assert diff <= 1, (
                f"control-column text-start drifted: original={original['textStart']}"
                f" value={value['textStart']} diff={diff}px "
                f"(original pad={original['padLeft']} value pad={value['padLeft']} "
                f"token={value['tokenInset']}) {original} {value}"
            )

            # Both paddings must resolve the single token, not a literal.
            assert value["padLeft"] == value["tokenInset"], (
                f"trigger pad-left {value['padLeft']} != token {value['tokenInset']}"
            )
            assert original["padLeft"] == value["tokenInset"], (
                f"box pad-left {original['padLeft']} != token {value['tokenInset']}"
            )

            assert not errors, f"JS errors: {errors}"

    def test_original_fill_and_original_border_emit_one_opacity_row(
        self, browser, tmp_path
    ):
        """The fill opacity row is emitted once, by the fill channel only.

        With fill ORIGINAL and border ORIGINAL (a per-feature author), the
        border reuses the fill's original detail for its column/colors/
        method readouts but must not re-emit a second fill-opacity row — the
        duplicate-row bug the user saw. The fill block owns exactly one
        opacity row, the border block owns none, and the readout is the
        author's own opacity as a bare number with the unit suffix.
        """
        with use_page(_make_author_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-layer-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            _open_author_style_panel(page)
            result = page.evaluate(
                _js("LayerControl/read_fill_opacity_duplicate"),
                {"fillMode": "original", "borderMode": "original"},
            )
            assert result.get("ok"), result
            assert result["fillMode"] == "original", result
            assert result["borderMode"] == "original", result
            # Exactly one opacity row, in the fill block; the border block
            # must not re-emit one.
            assert result["fillOpacityRowCount"] == 1, result
            assert result["borderOpacityRowCount"] == 0, result
            # The author layer paints fillOpacity 0.8: the bare number is 80
            # with the % unit suffix, and neither span is clipped.
            ro = result.get("fillReadout")
            assert ro is not None, result
            assert ro["valueText"] == "80", result
            assert ro["suffixText"] == "%", result
            assert ro["suffixHidden"] == "true", result
            assert ro["valueScrollW"] <= ro["valueClientW"], result
            assert ro["boxScrollW"] <= ro["boxClientW"], result
            assert not errors, f"JS errors: {errors}"

    def test_original_opacity_readout_not_truncated(self, browser, tmp_path):
        """The original-colors opacity readout never clips its value.

        The shared %-suffix split means the readout text is the bare number
        and the unit rides in a separate suffix span at the box's right inset.
        A clipped value would overflow its box (scrollWidth > clientWidth);
        the box itself must not scroll either. This guards the 5%→"5…"
        truncation the user reported.
        """
        with use_page(_make_author_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-layer-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            _open_author_style_panel(page)
            result = page.evaluate(
                _js("LayerControl/read_fill_opacity_duplicate"),
                {"fillMode": "original", "borderMode": "solid"},
            )
            assert result.get("ok"), result
            assert result["fillMode"] == "original", result
            assert result["fillOpacityRowCount"] == 1, result
            ro = result.get("fillReadout")
            assert ro is not None, result
            assert ro["valueScrollW"] <= ro["valueClientW"], result
            assert ro["boxScrollW"] <= ro["boxClientW"], result
            assert not errors, f"JS errors: {errors}"

    def test_read_only_rows_are_inert_and_copyable(self, browser, tmp_path):
        """The read-only style rows are inert but copyable.

        Four interaction contracts are pinned here (the row contract):
        1. No pointer affordance: computed cursor is default (never pointer),
           and the box carries no click handler that opens or edits anything.
        2. Not focusable: calling focus() must NOT move focus into the box
           (focusLanded is false), tabIndex is -1, no [tabindex]>=0 on the
           box, and the lethal querySelector('button,input,select,[tabindex]:not([tabindex="-1"])')
           returns null — a focusable element inside the box fails the test.
        3. Value text stays copyable: computed user-select on the value span
           is text, even though the panel is user-select: none — a read-out
           that cannot be selected cannot be copied.

        The box itself stays inert (points 1-2) while only the value text
        opts back into selection (point 3), so the read-only row is never a
        focus trap and never looks like a control.
        """
        with use_page(_make_author_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-layer-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            _open_author_style_panel(page)
            result = page.evaluate(_js("LayerControl/readonly_row_contract"))
            assert result.get("ok"), result
            assert result["boxCount"] > 0, result
            for box in result["boxes"]:
                assert box["cursor"] == "default", box
                assert box["cursor"] != "pointer", box
                assert box["onClick"] is False, box
                assert box["tabindex"] is None, box
                assert box["tabIndex"] == -1, box
                assert box["focusLanded"] is False, box
                assert box["focusable"] is None, box
                assert box["ariaDisabled"] == "true", box
            assert result["values"], result
            for value in result["values"]:
                assert value["userSelect"] == "text", value
            assert not errors, f"JS errors: {errors}"


class TestDeclaredFillBrowser:
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
            # P1 makes the original-colours state always available for a
            # fill-capable layer, even when the author painted a single colour
            # The declaration is the by-value mode, but the
            # option is offered alongside it.
            assert initial["originalAvailable"] is True, initial
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
            page.reload(wait_until="domcontentloaded")
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
