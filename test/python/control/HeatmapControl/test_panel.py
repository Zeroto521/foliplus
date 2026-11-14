"""HeatmapControl panel: state, dismiss behaviour and the portalled dropdowns.

The panel is one surface with three things pinned here: whether it stays open
(a press outside collapses it unless ``collapse_on_outside=False``), whether its
five dropdowns really work on a real device, and whether a press on another
Leaflet control still dismisses the scheme list.

The dropdown half is a regression guard for #793. The shared dropdown portals
its list out of the panel; two defects made the five controls look dead on a
real device while every other test stayed green:

1. The portalled list carried no z-index, so an expanded panel (its
   .leaflet-bottom section is raised to base+9 = 9999) painted over it: the
   trigger took focus and the listbox never appeared. The list must be
   hit-testable at its own centre.
2. A press on a row was classified "outside" by the panel's dismiss binding
   (bindOutsideCollapse only sampled container.contains), so the panel
   collapsed under the click and the pick was lost.

The scheme-list half is a regression guard for #833: the heatmap scheme list
portals outside the panel, and a LayerControl toggle (a real Leaflet control)
calls L.DomEvent.stop in its own click handler, so the event never reaches a
document *bubble* listener. Only the registry's capture-phase click listener can
observe it and dismiss the dropdown.

A fourth subject is pure geometry: the Method dropdown must fill the control
column while the class-count dropdown takes the compact secondary width, and the
two must not overlap. Every assertion here needs a real browser: jsdom has no
layout, no stacking order and no elementFromPoint.
"""

from __future__ import annotations

import json
from pathlib import Path

import folium
import pytest
from conftest import (
    _js,
    assert_map_unchanged,
    feature_collection,
    heatmap_ready,
    load_geojson,
    make_browser_page,
    map_center_zoom,
    point_feature,
    snippet,
    snippet_fn,
    touch_drag,
    use_page,
)

from foliplus import FullscreenControl, HeatmapControl, LayerControl

from .helper import _make_page, _panel_open


def _method_labels() -> tuple[str, str]:
    """The method row label for each built-in language, read from the
    common locale table (single source — never pin the string twice)."""
    base = Path(__file__).resolve().parents[4] / "foliplus" / "locale"
    en = json.loads((base / "common.en.json").read_text(encoding="utf-8"))
    zh = json.loads((base / "common.zh.json").read_text(encoding="utf-8"))
    return en["foliplus.classification_method"], zh["foliplus.classification_method"]


# Every visible trigger in the panel, in DOM order, with the geometry a real
# click needs. Re-read before each click: the panel reflows as rows appear.
TRIGGERS = snippet("HeatmapControl/dropdown_trigger")

# The five migrated controls, named by the bridged select they replaced. Row
# sets change as values change (a numeric aggregation shows the Field row), so
# each control is located through its own select instead of by a captured DOM
# index, and the ones whose pick hides a row run last.
CONTROLS = [
    ("Layer", "select[data-heatmap-layer]"),
    ("Field", "select[data-heatmap-field-select]"),
    ("Method", "select[data-heatmap-method]"),
    ("Classes", "select[data-heatmap-class-count]"),
    ("Aggregation", "select[data-heatmap-agg]"),
]

TRIGGER_AT = snippet("HeatmapControl/dropdown_trigger_at")

OPEN = snippet("HeatmapControl/dropdown_open")

AFTER_PICK = snippet("HeatmapControl/dropdown_after_pick")


class TestHeatmapControlPanelBrowser:
    """Panel open/collapse behavior and initial state."""

    def test_panel_collapses_on_outside_press_by_default(self, browser, tmp_path):
        """Default unchanged: a press outside the panel still collapses it.

        Regression gate for ``collapse_on_outside``. HeatmapControl shares
        ``createPanelControl`` with LayerControl, so the shell option must keep
        its historic behavior for any caller that does not opt out — and only
        LayerControl passes ``false``.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)
            assert _panel_open(page)

            page.mouse.click(900, 450)
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-collapsed",
                state="attached",
                timeout=5000,
            )
            assert not _panel_open(page), (
                "the heatmap panel stayed open after an outside press; its default "
                "is unchanged"
            )
            assert not errors, f"JS errors: {errors}"

    def test_panel_stays_open_on_outside_press_when_disabled(self, browser, tmp_path):
        """``collapse_on_outside=False`` also works for HeatmapControl.

        The second half of the wiring proof: the flag reaches the shell through
        the same option for both controls, so it is not a LayerControl special
        case.
        """
        with use_page(_make_page, browser, tmp_path, collapse_on_outside=False) as (
            page,
            errors,
        ):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)
            assert _panel_open(page)

            page.mouse.click(900, 450)
            page.wait_for_timeout(300)
            assert _panel_open(page), (
                "the heatmap panel collapsed on an outside press with "
                "collapse_on_outside=False"
            )
            assert not errors, f"JS errors: {errors}"

    def test_default_values_initialized(self, browser, tmp_path):
        """Constructor initializes all user-configurable defaults."""
        with use_page(_make_page, browser, tmp_path, expose_ctrl=True) as (
            page,
            errors,
        ):
            vals = page.evaluate(_js("HeatmapControl/read_manager_defaults"))
            assert vals["numClasses"] == 6, (
                f"numClasses expected 6 got {vals['numClasses']}"
            )
            assert vals["borderWeight"] == 1.5, (
                f"borderWeight expected 1.5 got {vals['borderWeight']}"
            )
            assert vals["borderColor"] in ("#333", "#333333"), (
                f"borderColor got {vals['borderColor']}"
            )
            assert vals["labelShow"] is True, "labelShow should be True"
            assert vals["method"] == "jenks"
            assert vals["scheme"] == "Reds"
            assert vals["agg"] == "count"
            assert not errors, f"JS errors: {errors}"

    def test_classes_row_label_stays_untruncated(self, browser, tmp_path):
        """The classes row reads by its method, at most two lines, and is never
        truncated, in both panels.

        The row has one visible label for two selects, so it takes the primary
        control's name (Method / 分类方法) — the same word the layer style
        panel shows. Each select keeps its own aria label (Method / Classes),
        and the shared 88px label column holds the word inside the
        280px panel. Range.getClientRects() is the line-box count: the element
        rect always reports one row. "Not truncated" is pinned by
        labelTruncated (scrollWidth <= clientWidth + 1): a label may wrap but
        must never be clipped or ellipsized.
        """
        _METHOD_EN, _METHOD_ZH = _method_labels()

        # One layer auto-selects on expand, which is what unhides the style
        # block (the rows exist in the DOM while it is hidden).
        with use_page(_make_page, browser, tmp_path, num_layers=1) as (
            page,
            errors,
        ):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl .foliplus-heatmap-extra-body:not(.foliplus-hidden)",
                state="visible",
                timeout=5000,
            )
            result = page.evaluate(
                _js("LayerControl/read_form_row_labels"),
                {"root": ".foliplus-heatmap-ctrl"},
            )
            assert result["ok"], result
            rows = {row["text"]: row for row in result["rows"]}
            # The visible label is locale-dependent; the panel's language follows
            # the browser, so pin both vocabularies rather than one page locale.
            label = next(
                (text for text in (_METHOD_EN, _METHOD_ZH) if text in rows), None
            )
            assert label, f"no method-labelled row among {sorted(rows)}"
            row = rows[label]
            expected_aria = {
                _METHOD_EN: [_METHOD_EN, "Classes"],
                _METHOD_ZH: [_METHOD_ZH, "分级数"],
            }[label]
            # The shared method label ("Classification Method" / 分类方法) is
            # the one label the 88px column cannot fit on one line (the wider
            # English word wraps to two). That is a product decision — the word
            # is shared with the layer style panel and was pinned by the user —
            # not a layout defect, so the label is allowed to wrap here, but it
            # must stay inside its own column (no rect overlap with the control
            # cell) and never be truncated by an ellipsis.
            assert row["labelLines"] <= 2, (
                f"the method label took more than two lines: {row}"
            )
            assert row["labelWidth"] == pytest.approx(88, abs=0.5), row
            assert result["labelWidthToken"] == "88px", result
            assert result["panelWidthToken"] == "280px", result
            assert row["panelWidth"] == pytest.approx(280, abs=1), row
            assert not row["labelOverlapsControl"], (
                f"the wrapped method label crossed into the control: {row}"
            )
            assert not row["labelTruncated"], (
                f"the method label was truncated by the column: {row}"
            )
            assert row["ariaLabels"] == expected_aria, row
            assert not errors, f"JS errors: {errors}"

    def test_layer_selection_triggers_render(self, browser, tmp_path):
        """Selecting a layer calls renderHexagons (cachedFeatures should be set)."""
        with use_page(_make_page, browser, tmp_path, expose_ctrl=True) as (
            page,
            errors,
        ):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)

            # Select the first non-placeholder layer
            opts = page.evaluate(_js("HeatmapControl/read_layer_options"))
            assert opts, "No layer options found"
            page.evaluate(_js("HeatmapControl/select_layer"), opts[0])
            page.wait_for_timeout(2000)

            # overlay (Canvas) should be visible with content after renderHexagons
            has_cached = page.evaluate(
                _js("HeatmapControl/read_manager_cached_features_set")
            )
            canvas_visible = page.evaluate(
                _js("HeatmapControl/read_canvas_display_visible")
            )
            assert has_cached, "cachedFeatures should be set after layer selection"
            assert canvas_visible, "Canvas should be visible after layer selection"
            assert not errors, f"JS errors: {errors}"


def _stub_native_fullscreen(html: str) -> str:
    """Disable the Fullscreen API before the page's scripts run, so
    FullscreenControl takes its pseudo-fullscreen fallback."""
    return html.replace(
        "<body>",
        f"<body>\n        <script>\n          {snippet('common/fullscreen_stub').strip()}\n        </script>",
    )


def _dropdown_make_page(browser, tmp_path, *, pseudo: bool = False):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    for i, (lat, lng) in enumerate([(26.08, 119.30), (26.09, 119.31), (26.07, 119.29)]):
        fg = folium.FeatureGroup(name=f"Points {i}", show=True)
        features = feature_collection(point_feature(lng, lat, {"val": lat}))
        folium.GeoJson(json.dumps(features)).add_to(fg)
        fg.add_to(m)
    LayerControl().add_to(m)
    HeatmapControl().add_to(m)
    FullscreenControl(hide_self=True, hide_others=False).add_to(m)
    html = m.get_root().render()
    if pseudo:
        html = _stub_native_fullscreen(html)
    return make_browser_page(
        browser,
        tmp_path,
        html,
        "heatmap_dropdown_pseudo" if pseudo else "heatmap_dropdown",
    )


def _hexbin_panel_ready(page) -> None:
    """Expand the panel and put it in the aggregation state the user reported:
    one layer selected, numeric aggregation, so all five controls are visible."""
    page.wait_for_selector(".foliplus-heatmap-ctrl", state="attached", timeout=10000)
    page.evaluate(_js("HeatmapControl/click_toggle_button"))
    page.wait_for_selector(
        ".foliplus-heatmap-ctrl.foliplus-is-expanded", state="attached"
    )
    page.evaluate(snippet("HeatmapControl/panel_ready_watch"))
    page.wait_for_timeout(400)
    page.evaluate(snippet("HeatmapControl/panel_set_agg_sum"))
    page.wait_for_timeout(400)


class TestHeatmapDropdownPanelBrowser:
    def test_five_dropdowns_open_above_the_panel_and_commit(self, browser, tmp_path):
        """Each of the five controls: popup on top, a real pick writes through
        the bridged select, and the panel is still open afterwards."""
        with use_page(_dropdown_make_page, browser, tmp_path) as (page, errors):
            _hexbin_panel_ready(page)
            triggers = page.evaluate(TRIGGERS)
            assert len(triggers) == 5, triggers

            seen: set[str] = set()
            for label, selector in CONTROLS:
                # Re-read the trigger before each press: earlier picks change the
                # row set, so coordinates captured earlier can be stale.
                trigger = page.evaluate(TRIGGER_AT, selector)
                assert trigger, f"{label}: no trigger in its row"
                seen.add(label)
                page.mouse.click(trigger["x"], trigger["y"])
                page.wait_for_timeout(180)

                opened = page.evaluate(OPEN)
                assert opened["open"] == 1, (
                    f"{trigger['name']}: the popup did not open ({opened})"
                )
                assert int(opened["zIndex"] or 0) > 9999, (
                    f"{trigger['name']}: the portalled list must outrank an "
                    f"expanded panel's section (9999), got z-index "
                    f"{opened['zIndex']!r}"
                )
                assert opened["topIsInsideList"], (
                    f"{trigger['name']}: the list's own centre resolves to "
                    f"{opened['topTag']} — the panel paints over the popup"
                )
                assert opened["option"], f"{trigger['name']}: no enabled row"

                page.mouse.click(opened["option"]["x"], opened["option"]["y"])
                page.wait_for_timeout(220)
                after = page.evaluate(AFTER_PICK)
                assert after["panelExpanded"], (
                    f"{trigger['name']}: picking a row collapsed the panel"
                )
                assert after["openLists"] == 0, after
                assert after["changes"], (
                    f"{trigger['name']}: the pick did not write through the "
                    "bridged select"
                )
                assert all(change["bubbles"] for change in after["changes"]), after
            assert seen == {label for label, _ in CONTROLS}, seen
            assert not errors, f"JS errors: {errors}"

    def test_tab_leaves_the_popup_from_the_control(self, browser, tmp_path):
        """Tab hands focus to the next control, not back to the top of the page.

        The focused row lives in the portalled popup; hiding it with the popup
        would drop focus on <body>, and the next Tab would restart at the first
        focusable element of the document. The popup returns focus to its
        trigger before closing so the browser's own Tab continues from there.
        """
        with use_page(_dropdown_make_page, browser, tmp_path) as (page, errors):
            _hexbin_panel_ready(page)
            trigger = page.evaluate(TRIGGER_AT, "select[data-heatmap-layer]")
            page.mouse.click(trigger["x"], trigger["y"])
            page.wait_for_timeout(150)
            page.keyboard.press("ArrowDown")
            page.wait_for_timeout(120)
            where = page.evaluate(snippet("HeatmapControl/arrow_down_inside_popup"))
            assert where["insidePopup"], where

            page.keyboard.press("Tab")
            page.wait_for_timeout(150)
            after = page.evaluate(snippet("HeatmapControl/tab_after_state"))
            assert after["openLists"] == 0, after
            assert not after["onBody"], (
                "Tab left focus on <body>; the next Tab would restart from the "
                "top of the page"
            )
            assert after["onAggTrigger"], (
                f"Tab did not continue from the control, focus is {after}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_pseudo_fullscreen_keeps_the_popup_on_the_covering_surface(
        self, browser, tmp_path
    ):
        """In the pseudo-fullscreen fallback the list mounts inside the
        covering container; on <body> the opaque map would paint over it."""
        with use_page(_dropdown_make_page, browser, tmp_path, pseudo=True) as (
            page,
            errors,
        ):
            page.wait_for_selector(".foliplus-fullscreen-toggle", state="attached")
            page.click(".foliplus-fullscreen-toggle")
            page.wait_for_function(_js("FullscreenControl/read_pseudo_fullscreen_on"))
            _hexbin_panel_ready(page)

            trigger = page.evaluate(TRIGGER_AT, "select[data-heatmap-layer]")
            assert trigger, "the layer trigger is missing"
            page.mouse.click(trigger["x"], trigger["y"])
            page.wait_for_timeout(200)
            opened = page.evaluate(OPEN)
            assert opened["open"] == 1, opened
            assert opened["topIsInsideList"], (
                "the popup must stay above the opaque pseudo-fullscreen map, "
                f"the centre resolves to {opened['topTag']}"
            )
            host = page.evaluate(snippet("HeatmapControl/host_check"))
            assert host["pseudoActive"], host
            assert host["hostIsContainer"], (
                f"the list must mount in the pseudo-fullscreen container, got "
                f"{host['hostClass']!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_placeholder_ink_tracks_selection(self, browser, tmp_path):
        """The layer dropdown keeps the muted placeholder ink until a layer
        is picked, then returns to the value ink at the same weight.

        Regression guard for the custom-dropdown placeholder hint: the
        bridged select's empty-value prompt ("Select a point layer") must
        read as a placeholder (muted, normal weight), not as a selected
        value. The trigger also carries .foliplus-form-select, whose color
        rule lands later in the merged bundle; the compound selector in
        dropdown.css is what keeps muted winning. jsdom cannot compute the
        styles, so only a real browser can prove the two inks differ. The
        trigger's own transition is the invariant: picking must move it off
        the muted ink, whatever the theme resolves that to.
        """
        with use_page(_dropdown_make_page, browser, tmp_path) as (page, errors):
            _hexbin_panel_ready(page)

            # _hexbin_panel_ready picks the first layer; clear it so the
            # placeholder prompt is the visible state again.
            page.evaluate(snippet("HeatmapControl/clear_hexbin_layer"))
            page.wait_for_timeout(300)

            # No layer picked: the prompt is the muted placeholder ink.
            before = page.evaluate(_js("HeatmapControl/read_layer_dropdown_ink"))
            assert before["ok"], before
            assert before["placeholder"], before
            assert before["label"] == before["nativeLabel"], (
                "the trigger must show the native select's empty-value prompt"
            )
            assert before["triggerWeight"] == before["nativeWeight"], (
                "the placeholder must keep the native weight, not italic"
            )

            # Pick a real layer: the trigger leaves the muted ink for the
            # value ink, and the placeholder class goes away.
            page.evaluate(snippet("HeatmapControl/pick_hexbin_layer"))
            page.wait_for_timeout(300)
            after = page.evaluate(_js("HeatmapControl/read_layer_dropdown_ink"))
            assert after["ok"], after
            assert not after["placeholder"], after
            assert after["triggerColor"] != before["triggerColor"], (
                "picking must move the trigger off the muted placeholder ink, "
                "got before={} after={}".format(
                    before["triggerColor"], after["triggerColor"]
                )
            )
            assert after["triggerWeight"] == before["triggerWeight"], (
                "picking must not change the weight, only the ink"
            )
            assert not errors, f"JS errors: {errors}"

    def test_input_skin_computed_parity(self, browser, tmp_path):
        """The Heatmap layer select resolves the shared input skin.

        The layer select (a static native <select> in template.ts) must
        resolve the same height, frame, radius, ink, type size and box model
        from .foliplus-input-skin as the LayerControl method select and
        label-size number (test_browser.py). jsdom never loads the stylesheet
        cascade, so only a browser can prove the parity: a missing
        foliplus-input-skin on this call site reads UA defaults (e.g.
        height: auto) and fails here.
        """
        with use_page(_dropdown_make_page, browser, tmp_path) as (page, errors):
            _hexbin_panel_ready(page)
            data = page.evaluate(_js("LayerControl/read_input_skin"))
            assert data["heat"]["ok"], f"heatmap layer select not found: {data}"
            t = data["tokens"]
            assert t["ctrlSize"], f"ctrl-size token unresolved: {data}"
            assert t["borderThin"], f"border-thin token unresolved: {data}"
            assert t["radiusSm"], f"radius-sm token unresolved: {data}"
            assert t["fontSizeMd"], f"font-size-md token unresolved: {data}"
            assert t["inputBg"], f"input-bg token unresolved: {data}"
            assert t["textPrimary"], f"text-primary token unresolved: {data}"
            got = data["heat"]["layer"]
            assert got["height"] == t["ctrlSize"], (data,)
            assert got["borderTopWidth"] == t["borderThin"], (data,)
            assert got["borderRadius"] == t["radiusSm"], (data,)
            assert got["backgroundColor"] == t["inputBg"], (data,)
            assert got["fontSize"] == t["fontSizeMd"], (data,)
            assert got["color"] == t["textPrimary"], (data,)
            assert got["boxSizing"] == "border-box", (data,)
            assert not errors, f"JS errors: {errors}"


def _polygon_layer() -> folium.GeoJson:
    """Overlay layer with a numeric property, for the style drawer's ramp mode."""
    return folium.GeoJson(
        json.dumps(load_geojson("common", "polygons_fuzhou_3offset")),
        name="Polygon data",
    )


def _points_group() -> folium.FeatureGroup:
    """One point layer, so the heatmap auto-selects it and opens its config."""
    fg = folium.FeatureGroup(name="Points", show=True)
    folium.GeoJson(json.dumps(load_geojson("common", "points_fuzhou_3offset"))).add_to(
        fg
    )
    return fg


def _centre(page, selector: str) -> dict:
    return page.evaluate(_js("platform/read_element_centre"), selector)


def _outside_press_make_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    _polygon_layer().add_to(m)
    _points_group().add_to(m)
    LayerControl(position="topright").add_to(m)
    HeatmapControl(position="bottomleft").add_to(m)
    html = m.get_root().render()
    return make_browser_page(browser, tmp_path, html, "picker_outside_press")


class TestSchemePickerOutsidePressBrowser:
    def test_press_on_collapsed_layer_control_closes_the_list(self, browser, tmp_path):
        with use_page(_outside_press_make_page, browser, tmp_path) as (page, errors):
            # Expand the heatmap panel and open its colour scheme list.
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)
            page.wait_for_selector(
                ".foliplus-heatmap-scheme-bar", state="visible", timeout=5000
            )
            box = _centre(page, ".foliplus-heatmap-scheme-bar")
            page.mouse.click(box["x"], box["y"])
            page.wait_for_selector(
                ".foliplus-scheme-picker-portal", state="attached", timeout=3000
            )

            # Press the collapsed LayerControl control. Its own toggle calls
            # L.DomEvent.stop, so only the capture-phase document listener can
            # see the press and dismiss the dropdown.
            state = page.evaluate(_js("platform/read_picker_panel_state"))
            assert state["layer"]["collapsed"], state

            clicked = page.evaluate(_js("LayerControl/click_collapsed_layer_toggle"))
            assert clicked["clicked"], clicked
            assert clicked["nowExpanded"], clicked

            # The list must close even though the press was stopped at the control.
            page.wait_for_selector(
                ".foliplus-scheme-picker-portal", state="detached", timeout=3000
            )
            after = page.evaluate(_js("platform/read_picker_panel_state"))
            assert after["open"] is False, after
            assert after["heatmap"]["expanded"], after
            assert not errors, f"JS errors: {errors}"


def _make_geometry_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    for i, (lat, lng) in enumerate([(26.08, 119.30), (26.09, 119.31), (26.07, 119.29)]):
        fg = folium.FeatureGroup(name=f"Points {i}", show=True)
        features = feature_collection(point_feature(lng, lat, {"val": lat}))
        folium.GeoJson(json.dumps(features)).add_to(fg)
        fg.add_to(m)
    LayerControl().add_to(m)
    HeatmapControl().add_to(m)
    html = m.get_root().render()
    return make_browser_page(
        browser,
        tmp_path,
        html,
        "heatmap_classes_row_geometry",
    )


class TestClassesRowGeometryBrowser:
    """The Method dropdown fills the control column, the class-count dropdown
    takes the compact secondary width, and the two do not overlap."""

    def test_classes_row_geometry(self, browser, tmp_path):
        with use_page(_make_geometry_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded", state="attached"
            )
            # Pick a point layer and settle the aggregation so the Method /
            # Classes row is laid out (the rows are hidden until a layer is
            # selected). Same setup as the dropdown-panel browser test.
            page.evaluate(snippet("HeatmapControl/panel_ready_watch"))
            page.wait_for_timeout(400)
            page.evaluate(snippet("HeatmapControl/panel_set_agg_sum"))
            page.wait_for_timeout(400)
            # The wrappers only get a non-zero box once the panel settles;
            # wait for the method wrapper to be laid out before measuring, so
            # the probe reads a visible element rather than a 0-width stub.
            page.wait_for_function(
                """() => {
                    const method = document.querySelector(
                        ".foliplus-heatmap-ctrl .foliplus-dropdown.foliplus-heatmap-method",
                    );
                    return !!method && method.offsetWidth > 0 && method.offsetHeight > 0;
                }"""
            )
            data = page.evaluate(_js("HeatmapControl/read_classes_row_geometry"))
            assert data["ok"], data
            # The probe must have measured laid-out wrappers; a 0-width
            # measurement would make the geometry relationships trivially true.
            assert data["widthsPositive"], data
            assert data["methodFillsControl"], data
            assert data["classesAtSecondary"], data
            assert data["noOverlap"], data
            assert not errors, f"JS errors: {errors}"


class TestHeatmapPanelTouchBrowser:
    """A touch drag over the fold-panel body scrolls it, not the map."""

    def test_touch_drag_over_the_fold_panel_does_not_pan_the_map(
        self, touch_browser, tmp_path
    ):
        # The fold panel comes from the shared createPanelControl factory, which
        # binds the touch containment on the scrollable panel-content body.
        with use_page(_make_page, touch_browser, tmp_path, num_layers=1) as (
            page,
            errors,
        ):
            page.evaluate(
                "document.querySelector('.foliplus-heatmap-ctrl .foliplus-toggle-btn')?.click()"
            )
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            assert _panel_open(page) is True
            page.wait_for_timeout(300)
            rect = page.evaluate(
                f"({snippet_fn('common/element_rect')})"
                "('.foliplus-heatmap-ctrl .foliplus-panel-content')"
            )
            before = map_center_zoom(page)
            touch_drag(
                page,
                rect["x"] + rect["w"] / 2,
                rect["y"] + rect["h"] / 2,
                rect["y"] + rect["h"] / 2 - 80,
            )
            page.wait_for_timeout(300)
            assert_map_unchanged(before, map_center_zoom(page))
            assert not errors, f"JS errors: {errors}"
