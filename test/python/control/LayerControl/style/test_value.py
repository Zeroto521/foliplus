"""Split of test_style.py by dimension."""

from __future__ import annotations

import base64

import copy

import json

import re

import time

from pathlib import Path

import folium

import pytest

from conftest import (
    _js,
    feature_collection,
    heatmap_ready,
    leaflet_path,
    load_geojson,
    make_browser_page,
    panel_ready,
    point_feature,
    render,
    snippet,
    use_page,
    use_raw_page,
)

from foliplus import HeatmapControl, LayerControl

def _method_labels() -> tuple[str, str]:
    """The method row label for each built-in language, read from the locale
    table (single source — never pin the string twice)."""
    base = Path(__file__).resolve().parents[5] / "foliplus" / "locale"
    en = json.loads((base / "common.en.json").read_text(encoding="utf-8"))
    zh = json.loads((base / "common.zh.json").read_text(encoding="utf-8"))
    return en["foliplus.classification_method"], zh["foliplus.classification_method"]

from ..helper import _expand_panel, _geo_zone, _tiny_png, _write_html

from ..helper_browser import LayerControlBrowserBase

class TestStyleBrowser(LayerControlBrowserBase):
    def test_sole_basemap_opacity_zero_shows_hatch(self, browser, tmp_path):
        """Dragging the sole basemap's opacity slider to 0 lights the no-basemap hatch.

        The judgement in `syncNoBasemap` (effective visibility = intent
        AND `opacity ?? 1 > 0`) is unit-tested; the trigger is the slider
        drag, which goes through `commitOpacityPct` → `applyProjection`.
        This is the end-to-end bridge — the failure mode is a correct
        judgement that is never called, so the hatch stays off after the
        user has visually emptied every basemap. Overlay opacity must not
        touch the hatch (unrelated to basemap visibility).
        """
        # Default folium map carries one OSM TileLayer; LayerControl picks
        # it up on attach as the sole base row. Hiding that one is enough
        # to leave the map with no visible basemap — which is exactly the
        # scenario where intent still says visible.
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        _expand_panel(m)
        # Expose the control instance for the probe (dev build keeps names).
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            m.get_root().render(),
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found"
        html_path = tmp_path / "test_sole_basemap_opacity.html"
        html_path.write_text(html, encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            result = page.evaluate(_js("LayerControl/base_opacity_e2e"))
            assert result is not None
            assert result.get("error") is None, f"setup failed: {result}"

            # Sole base layer, untouched: no hatch.
            assert result["before"]["noBaseMap"] is False, result

            # Drag the sole basemap's opacity to 0: hatch on.
            assert result["atZero"]["noBaseMap"] is True, (
                f"opacity=0 on sole basemap did not light the hatch: {result}"
            )
            assert result["atZero"]["liOpacity"] == 0, result

            # Overlay opacity is unrelated to basemap visibility. Assert the
            # slider actually rendered (a bare featureGroup would not) so the
            # assertion is not vacuous.
            assert result["overlayZero"]["sliderFound"] is True, (
                f"overlay had no opacity slider — vacuous assertion: {result}"
            )
            assert result["overlayZero"]["liOpacity"] == 0, result
            assert result["overlayZero"]["noBaseMap"] is True, (
                f"overlay opacity must not clear the hatch: {result}"
            )

            # Back to 100: hatch off again.
            assert result["atHundred"]["noBaseMap"] is False, (
                f"opacity=1 did not clear the hatch: {result}"
            )
            assert result["atHundred"]["liOpacity"] == 1, result
    def test_color_layer_coexists_with_tiles(self, browser, tmp_path):
        """Color and tile basemaps coexist. Checking the color basemap's
        checkbox activates its own pane (the retired
        `foliplus-layer-tile-hidden` contract is gone — tiles stay in the DOM
        and remain fetchable)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False).add_to(
            m
        )

        html_path = tmp_path / "test_color_tiles.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            # Check the color basemap's checkbox — the only legitimate path
            # to show the color layer. Clicking the row body no longer does
            # it (#494).
            toggle = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert toggle is not None and toggle["ok"] is True, toggle
            page.wait_for_timeout(500)

            result = page.evaluate(_js("LayerControl/read_color_tile_state"))
            assert result is not None
            # The retired tile-hidden contract must not be applied.
            assert result["tileHidden"] is False, (
                "color layer must not stamp foliplus-layer-tile-hidden"
            )
            assert result["colorBg"] is True, "color item should have active class"
    def test_color_basemap_checkbox_toggles_visibility(self, browser, tmp_path):
        """Checking the color basemap's checkbox must toggle its visibility.

        The row's checkbox column holds a real ``<input type="checkbox">``
        (like every other basemap row).  Checking it paints the container
        background (``.foliplus-active`` + ``--color-layer-bg``); unchecking it clears
        both.  Without the fix the row has only a color picker and no
        checkbox, so the toggle cannot happen.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        html_path = tmp_path / "test_color_checkbox.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            # Initial state: checkbox exists and is unchecked.
            state = page.evaluate(_js("LayerControl/read_color_checkbox_state"))
            assert state is not None
            assert state["hasCheckbox"] is True, (
                "color basemap row must have a real checkbox"
            )
            assert state["checked"] is False, "color basemap starts unchecked"
            assert state["active"] is False, "container starts without .foliplus-active"

            # Check the checkbox → container background takes effect.
            result = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert result is not None and result["ok"] is True, result
            assert result["checked"] is True

            state = page.evaluate(_js("LayerControl/read_color_checkbox_state"))
            assert state["checked"] is True
            assert state["active"] is True, "checking must mark the color row active"
            assert state["colorVisible"] is True, (
                "checking must show the color pane face"
            )

            # Uncheck → container background cleared.
            result = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert result is not None and result["ok"] is True, result
            assert result["checked"] is False

            state = page.evaluate(_js("LayerControl/read_color_checkbox_state"))
            assert state["checked"] is False
            assert state["active"] is False, (
                "unchecking must clear the color row active class"
            )
            assert state["colorVisible"] is False, (
                "unchecking must hide the color pane face"
            )
    def test_color_basemap_zorder_stack(self, browser, tmp_path):
        """Color basemap participates in the z-order ladder like tile basemaps.

        Row order = visual stack order. When the color row is above a tile
        basemap, its pane has a higher z-index and covers the tiles; when
        below, the tiles cover it. Reordering flips the stack live.
        """
        tile = folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False)
        with use_page(self._make_page, browser, tmp_path, tile) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            # Read initial state.
            state0 = page.evaluate(_js("LayerControl/read_color_checkbox_state"))
            assert state0 is not None

            # Ensure the color basemap is shown (check the checkbox if unchecked).
            if not state0.get("checked"):
                result = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
                assert result["ok"] is True
            else:
                # Already checked — verify the pane exists.
                result = {"ok": True, "checked": True}

            # Initial state: color pane exists and tile pane exists.
            state = page.evaluate(_js("LayerControl/color_zorder_stack"))
            assert state["ok"] is True
            assert state["colorPaneFound"] is True, "color pane must exist after show"
            assert state["tilePaneFound"] is True
            assert state["colorPaneZ"] is not None
            assert state["tilePaneZ"] is not None
            initialColorZ = state["colorPaneZ"]

            # Case 1: move color above tile → color pane z increases.
            page.evaluate(_js("LayerControl/set_probe"), {"action": "above"})
            state = page.evaluate(_js("LayerControl/color_zorder_stack"))
            assert state["ok"] is True
            assert state["colorPaneZ"] > initialColorZ, (
                f"color above: z should increase, {initialColorZ} -> {state['colorPaneZ']}"
            )

            # Case 2: move color below tile → color pane z drops below the tile pane.
            page.evaluate(_js("LayerControl/set_probe"), {"action": "below"})
            state = page.evaluate(_js("LayerControl/color_zorder_stack"))
            assert state["ok"] is True
            assert state["colorPaneZ"] < state["tilePaneZ"], (
                f"color below: color pane z must be below tile pane z, "
                f"color={state['colorPaneZ']} tile={state['tilePaneZ']}"
            )
            assert state["colorPaneZ"] == initialColorZ, (
                f"color below: z should return to initial, "
                f"{initialColorZ} -> {state['colorPaneZ']}"
            )

            # Case 3: reorder back above → z-indexes flip again (live).
            page.evaluate(_js("LayerControl/set_probe"), {"action": "above"})
            state = page.evaluate(_js("LayerControl/color_zorder_stack"))
            assert state["ok"] is True
            assert state["colorPaneZ"] > state["tilePaneZ"], (
                "reorder back above: color z must increase again"
            )
    def test_setvisible_out_of_zoom_range_fires_intent_not_change(
        self, browser, tmp_path
    ):
        """A setVisible(true) that policy gates fires LAYER_INTENT_CHANGE only.

        User-reported boundary: a layer with a stored zoom range that
        excludes the current map zoom is policy-hidden. Flipping the
        user's checkbox changes the stored intent but not the effective
        map membership — the zoom-range policy still blocks it.

        `LAYER_CHANGE` rides the effective flip (`intent && policy`), so
        a policy-gated flip fires nothing on that channel. External
        controls that mirror the user's checkbox state in their own UI
        (a cycling slider, a mode badge) would never hear the movement
        and would desync from the panel. `LAYER_INTENT_CHANGE` is the
        separate channel for that user-only signal.

        This is the exact boundary the executor's effective-only emit
        could not see: the LAYER_CHANGE emission is gated on
        `wrote === true`, and a policy-gated flip writes nothing to
        the map.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/intent_change_gated_by_zoom_range"),
                load_geojson("common", "point_1193_2608"),
            )
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            assert not errors, f"JS errors: {errors}"

            # Precondition: the map is at zoom 12, the stored range is
            # [15, 18], and setVisible(false) recorded a false intent
            # while the layer was already policy-hidden.
            assert result["zoom"] == 12, result
            assert result["range"] == [15, 18], result
            assert result["beforeShow"]["intentVisible"] is False, result
            assert result["beforeShow"]["onMap"] is False, result
            assert result["ok"] is True, result

            # After setVisible(true): the stored intent flipped, the
            # checkbox the panel shows is checked, but the layer never
            # entered the map — the zoom-range policy still gates it.
            assert result["afterShow"]["intentVisible"] is True, result
            assert result["afterShow"]["onMap"] is False, result

            # Only one LAYER_INTENT_CHANGE for this layer, carrying the
            # fresh intent the user just recorded.
            assert result["intentCount"] == 1, result
            assert result["intentPayloads"] == [
                {
                    "id": "__test_intent_gated__",
                    "kind": "vector",
                    "intent": {"visible": True},
                }
            ], result

            # No LAYER_CHANGE on the effective channel — the layer
            # stayed off the map throughout the setVisible(true) call.
            assert result["changeCount"] == 0, result
    def test_style_fill_value_paints_the_map_by_value(self, browser, tmp_path):
        """The by-value mode repaints the map, and solid flattens it back.

        The ramp mode maps each polygon's numeric property to a color, so the
        rendered SVG carries one fill per value. Reading the panel's color bar
        only proves the DOM changed; this reads the map's own path elements
        under the leaflet-map-pane and asserts the real paint. Switching to the
        solid mode flattens every polygon to the same fill, so the distinct
        painted-fill set collapses to one — the negative control that a single
        color really is one color, and that "ramp" was what made them differ.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._ramp_layer(),
            slug="style_fill_value_paints_map",
        ) as (page, errors):
            self._open_style_ramp(page)

            # The ramp mode is the default for a numeric field, but set it
            # explicitly so the assertion targets the mode, not an accident of
            # the default.
            set_mode = page.evaluate(
                _js("LayerControl/set_fill_mode"), {"mode": "value"}
            )
            assert set_mode["ok"], f"could not enter the value mode: {set_mode}"
            page.wait_for_timeout(300)

            ramp = page.evaluate(_js("LayerControl/read_map_fills"))
            assert ramp["count"] >= 3, (
                f"expected at least the three polygons painted, got {ramp}"
            )
            assert ramp["present"] >= 3, (
                f"the ramp mode did not paint distinct per-value fills: {ramp}"
            )
            assert len(ramp["fills"]) >= 3, (
                f"the ramp mode did not paint at least three distinct colors: {ramp}"
            )

            # Negative control: the solid mode paints every polygon the same
            # fill, so the distinct painted-fill set collapses to one value.
            set_mode = page.evaluate(
                _js("LayerControl/set_fill_mode"), {"mode": "solid"}
            )
            assert set_mode["ok"], f"could not enter the solid mode: {set_mode}"
            page.wait_for_timeout(300)

            solid = page.evaluate(_js("LayerControl/read_map_fills"))
            assert solid["count"] >= 3, f"the solid mode dropped polygons: {solid}"
            assert solid["present"] == 1, (
                f"the solid mode did not flatten to one fill: {solid}"
            )
            assert not errors, f"JS errors: {errors}"
    def test_style_fill_category_paints_distinct_districts(self, browser, tmp_path):
        """The category by-value mode paints each district its own color.

        A layer whose only value column is a string (GADM NAME_3) offers the
        by-value entry through the category machine: the field select labels
        the column as categorical, the method and classes rows are absent (a
        qualitative scheme needs no classification step), and the map carries
        more than one distinct fill. This is the negative control for the
        numeric ramp: distinct colors come from the categories, not from a
        numeric split.
        """
        data = copy.deepcopy(
            json.loads(
                Path(__file__)
                .resolve()
                .parents[5]
                .joinpath("doc", "source", "data", "gadm41_CHN_3_Shanghai.geojson")
                .read_text(encoding="utf-8")
            )
        )
        layer = folium.GeoJson(
            json.dumps(data),
            name="Municipal Boundaries",
            style_function=lambda _f: {"color": "gray"},
        )
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            layer,
            slug="style_fill_category_districts",
        ) as (page, errors):
            self._open_style_ramp(page)

            set_mode = page.evaluate(
                _js("LayerControl/set_fill_mode"), {"mode": "value"}
            )
            assert set_mode["ok"], f"could not enter the value mode: {set_mode}"
            page.wait_for_timeout(300)

            picked = page.evaluate(
                _js("LayerControl/category_fill_select_field"), {"field": "NAME_3"}
            )
            assert picked["ok"], f"could not select NAME_3: {picked}"
            page.wait_for_timeout(300)

            state = page.evaluate(_js("LayerControl/category_fill_read"))
            assert state["count"] >= 4, f"expected the districts painted, got {state}"
            assert state["present"] >= 2, (
                f"the category mode did not paint distinct district fills: {state}"
            )
            assert not state["hasMethodRow"], (
                f"the category mode must not show a method row: {state}"
            )
            assert not state["hasClassesRow"], (
                f"the category mode must not show a classes row: {state}"
            )
            assert state["fieldOptions"] is not None and all(
                o and "(" not in o for o in state["fieldOptions"]
            ), f"the field options must be bare field names: {state}"
            assert not errors, f"JS errors: {errors}"
