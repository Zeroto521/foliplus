"""Split of test_panel.py by dimension."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

import folium
import pytest
from conftest import (
    _js,
    assert_map_unchanged,
    feature_collection,
    heatmap_ready,
    leaflet_path,
    leaflet_points,
    load_geojson,
    make_browser_page,
    map_center_zoom,
    panel_ready,
    point_feature,
    render,
    snippet,
    snippet_fn,
    touch_drag,
    use_page,
    use_raw_page,
)
from playwright.sync_api import TimeoutError

from foliplus import HeatmapControl, LayerControl

from ..helper import _expand_panel, _geo_mixed, _write_html
from ..helper_browser import LayerControlBrowserBase


class TestPanelBrowser(LayerControlBrowserBase):
    def test_keydown_up_moves_focus(self, browser, tmp_path):
        """ArrowUp moves keyboard focus to the previous layer row."""
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay1, overlay2) as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/keydown_up_moves_focus"))
            assert result is not None, "keydown_up_moves_focus failed"
            assert result["focusedElement"] == result["expectedElement"], (
                f"ArrowUp should focus previous item, got {result}"
            )

    def test_keydown_down_moves_focus(self, browser, tmp_path):
        """ArrowDown moves keyboard focus to the next layer row."""
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay1, overlay2) as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/keydown_down_moves_focus"))
            assert result is not None, "keydown_down_moves_focus failed"
            assert result["focusedElement"] == result["expectedElement"], (
                f"ArrowDown should focus next item, got {result}"
            )

    def test_keydown_escape_clears_focus(self, browser, tmp_path):
        """Escape clears the keyboard-active focus state."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            # The style assertions below need the init pass done: rows render
            # checked by default and initLayerItem (on an init timer) is what
            # adds the .foliplus-active class and the per-state titles.
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/keydown_escape_clears_focus"))
            assert result is not None, "keydown_escape_clears_focus failed"
            assert result["beforeEscape"] is True, "ArrowDown should first set focus"
            assert result["focusCleared"] is True, (
                f"Escape should clear focus, got {result}"
            )
            assert result["focusRetained"] is True, (
                "Escape must not blur to <body>, got " + str(result)
            )
            assert result["checkedRetainedFocus"] is True, (
                "the checked row must keep DOM focus through Escape, got " + str(result)
            )
            assert result["glowVisibleBefore"] is True, (
                "the cursor glow must be drawn before Escape (the JS class was "
                "on the row), got " + str(result)
            )
            assert result["washRestored"] is True, (
                "a checked row gets its selected wash back through Escape, got "
                + str(result)
            )
            assert result["iconKeptBlack"] is True, (
                "a checked row keeps its black type icon through Escape, got "
                + str(result)
            )
            assert result["glowCleared"] is True, (
                "Escape must clear the cursor-only glow, got " + str(result)
            )
            assert result["outlineCleared"] is True, (
                "Escape must not leave the browser default dark outline on the "
                "still-focused row, got " + str(result)
            )

            # A real hover must still light the recipe on the cancelled row:
            # the recipe keys on :hover + the JS class, and Escape only lifts
            # the class. Cancel the cursor again for a deterministically
            # cancelled row, hover with the real pointer, then move it away
            # and assert the fall-back.
            page.evaluate(_js("LayerControl/dispatch_escape_on_active"))
            page.hover(".foliplus-layer-item.foliplus-active")
            # The grip is the one recipe property with an opacity transition
            # (color/box-shadow are transition: none), so wait it out before
            # measuring or the computed value is mid-flight.
            page.wait_for_function(
                _js("LayerControl/wait_drag_handle_opacity"),
                arg=[
                    ".foliplus-layer-item.foliplus-active .foliplus-layer-rail .drag-handle",
                    0,
                    "1",
                ],
                timeout=2000,
            )
            on_hover = page.evaluate(_js("LayerControl/read_active_row_lit"))
            page.mouse.move(5, 400)
            page.wait_for_function(
                _js("LayerControl/wait_drag_handle_opacity"),
                arg=[
                    ".foliplus-layer-item.foliplus-active .foliplus-layer-rail .drag-handle",
                    0,
                    "0",
                ],
                timeout=2000,
            )
            off_hover = page.evaluate(_js("LayerControl/read_active_row_state"))
            assert on_hover["grip"] == "1", (
                "hovering the cancelled row must show the drag grip, got "
                + str(on_hover)
            )
            assert on_hover["glow"] is True, (
                "hovering the cancelled row must light the glow, got " + str(on_hover)
            )
            assert on_hover["more"] == off_hover["more"], (
                "a checked row keeps the more button in the action color at "
                "rest and on hover alike (its .foliplus-active leg), got "
                + str(on_hover)
                + " vs "
                + str(off_hover)
            )
            assert off_hover["grip"] == "0", (
                "leaving the row must hide the grip again, got " + str(off_hover)
            )
            assert off_hover["bg"] not in ("rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"), (
                "leaving the row must fall back to the selected wash, got "
                + str(off_hover)
            )

    def test_checkbox_dblclick_does_not_focus_layer(self, browser, tmp_path):
        """Two quick checkbox toggles must not zoom the map (focusLayer).

        The browser fires `dblclick` after the second click. That event used
        to bubble to the panel handler and open the focus-layer overlay.
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(self._make_page, browser, tmp_path, fg) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/checkbox_dblclick_no_focus_layer"))
            assert result is not None and "error" not in result, (
                f"checkbox dblclick snippet failed: {result}"
            )
            assert result["focusing"] is False, (
                "double-click on checkbox must not mark the row as focusing, got "
                + str(result)
            )
            assert result["mask"] is False, (
                "double-click on checkbox must not draw the focus mask, got "
                + str(result)
            )
            assert result["focusActive"] is False, (
                "double-click on checkbox must not activate the focus overlay, got "
                + str(result)
            )

    def test_focus_layer_draws_rect_and_mask(self, browser, tmp_path):
        """Double-clicking an overlay draws the dashed rect + inverse mask."""
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(self._make_page, browser, tmp_path, fg, slug="focus_overlay") as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/focus_layer_draws_overlay"))
            assert result is not None, "focus_layer_draws_overlay failed"
            assert result["rectDrawn"] is True, f"focus rect missing, got {result}"
            assert result["maskDrawn"] is True, f"focus mask missing, got {result}"
            assert result["rowHighlighted"] is True, (
                f"row not highlighted, got {result}"
            )

    def test_focus_mask_covers_viewport_after_fitbounds_zoomout(
        self, browser, tmp_path
    ):
        """A small container at high zoom focusing a wide layer must not leave
        un-dimmed strips outside the mask.

        The mask's outer ring is drawn once from
        ``map.getBounds().pad(1)`` *before* ``fitBounds`` runs. When
        ``fitBounds`` zooms out to fit a wide layer into a small container,
        the new viewport spans far more geography than the pre-animation
        outer ring — the dim stops at the old boundary and bright strips
        leak around the corners. The fix draws the outer ring as the
        Web-Mercator world envelope so it covers any viewport at any zoom.
        """
        # 20°x20° polygon: much wider than a small container at zoom 16,
        # so ``fitBounds`` must zoom out to fit it.
        fg = folium.FeatureGroup(name="Wide", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_world_box"),
        ).add_to(fg)
        m = folium.Map(location=[26.08, 119.30], zoom_start=16)
        LayerControl().add_to(m)
        fg.add_to(m)
        html = m.get_root().render()
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found in rendered HTML"
        with use_page(
            make_browser_page, browser, tmp_path, html, "focus_mask_ghost"
        ) as (page, _):
            page.set_viewport_size({"width": 320, "height": 240})
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            item = page.query_selector(".foliplus-layer-item")
            assert item is not None, "no layer row rendered"
            # Register a one-shot signal: the fitBounds `moveend` is the
            # deterministic "animation settled" marker. The mask is drawn
            # synchronously *before* fitBounds (drawFocusMask), so by this
            # moveend the post-fitBounds viewport is live and the mask is
            # still shown — registerAutoCancel dismisses it only 1050ms
            # after this same moveend. Reading right at the signal removes
            # the fixed-sleep race against that dismiss window.
            page.evaluate(snippet("LayerControl/arm_fit_settled"))
            item.dispatch_event("dblclick")
            try:
                page.wait_for_function(
                    snippet("LayerControl/fit_settled"), timeout=5000
                )
            except TimeoutError:
                pytest.fail(
                    "fitBounds did not settle (__fitSettled) within 5s — "
                    "the focus mask read window raced; probe was not run"
                )
            result = page.evaluate(_js("LayerControl/focus_mask_covers_viewport"))
            assert result is not None, "focus_mask_covers_viewport failed"
            assert "error" not in result, f"probe error: {result}"
            assert result["coversViewport"] is True, (
                f"focus mask outer ring must cover the post-fitBounds "
                f"viewport: outer={result['outer']} vs view={result['view']} "
                f"at zoom={result['zoom']}"
            )

    def test_focus_rect_is_marching_ants(self, browser, tmp_path):
        """The focus rect paints the shared marching-ants look, live.

        Pins the three cascade facts a regression can silently drop: accent
        stroke (not Leaflet's default, not a black fallback), the shared
        ``--foliplus-dash-rhythm``, and the march animation. Tokens are
        sampled from the live page — never hardcoded — so a broken custom
        property fails here instead of only in a human eye.
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(
            self._make_page, browser, tmp_path, fg, slug="focus_rect_ants"
        ) as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/focus_rect_marching_ants"))
            assert result is not None, "focus_rect_marching_ants failed"
            assert result["rectDrawn"] is True, f"focus rect missing, got {result}"

            accent = self._sample_token(page, "--foliplus-accent-primary")
            dash = page.evaluate(_js("LayerControl/read_dash_rhythm"))
            assert result["stroke"] == accent, (
                f"focus rect stroke must be the accent token, "
                f"got {result['stroke']} vs {accent}"
            )
            assert result["fill"] in ("none", "rgba(0, 0, 0, 0)"), (
                f"focus rect must stay unfilled, got {result['fill']}"
            )
            # strokeDasharray is normalized ("6px, 4px"); the token is
            # space-separated ("6px 4px"). Compare as token lists.
            got_dash = result["strokeDasharray"].replace(",", " ").split()
            want_dash = dash.replace(",", " ").split()
            assert got_dash == want_dash, (
                f"focus rect dash rhythm must be {want_dash}, got {got_dash}"
            )
            assert result["animationName"] == "foliplus-focus-march", (
                f"focus rect must keep the march animation, got {result}"
            )

    def test_geometry_focus_drops_ua_ring_for_marching_ants(self, browser, tmp_path):
        """A focused map path paints a marching-ants bbox, not a stroke restyle.

        The UA ring is black on Windows Chrome and system-blue on macOS Chrome
        (outline-style: auto + Highlight). The selection signal is the same
        marquee as the LayerControl focus rect, so line data keeps its stroke.
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(
            self._make_page, browser, tmp_path, fg, slug="geom_focus_ants"
        ) as (page, _):
            page.emulate_media(reduced_motion="no-preference")
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/geometry_focus_marching_ants"))
            assert result is not None, "geometry_focus_marching_ants failed"
            assert result["focused"] is True, f"path never took focus, got {result}"
            assert result["outlineStyle"] == "none", (
                f"focused geometry must not paint the UA outline, got {result}"
            )
            assert result["marqueePresent"] is True, (
                f"focused geometry must draw the marching-ants bbox, got {result}"
            )

            accent = self._sample_token(page, "--foliplus-accent-primary")
            dash = page.evaluate(_js("LayerControl/read_dash_rhythm"))
            assert result["marqueeStroke"] == accent, (
                f"marquee stroke must be accent, "
                f"got {result['marqueeStroke']} vs {accent}"
            )
            got_dash = result["marqueeDasharray"].replace(",", " ").split()
            want_dash = dash.replace(",", " ").split()
            assert got_dash == want_dash, (
                f"marquee dash rhythm must be {want_dash}, got {got_dash}"
            )
            assert result["marqueeAnimation"] == "foliplus-focus-march", (
                f"marquee must keep the march animation, got {result}"
            )

    def test_geometry_focus_marquee_survives_zoom(self, browser, tmp_path):
        """Focused geometry's marching-ants bbox stays locked to the geometry
        across a zoom change.

        #668 wired the marquee to re-derive from the live bbox on `moveend`,
        but `getBBox()` is cached by the browser's SVG layout engine and only
        refreshes on the next frame. A synchronous redraw inside `moveend`
        reads the pre-zoom bbox and the marquee freezes at the old position.
        The fix defers the redraw with `requestAnimationFrame`. This test
        captures real pixel bboxes before and after a zoom and asserts the
        marquee tracks the geometry within 1px (plus the 4px pad).
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(
            self._make_page, browser, tmp_path, fg, slug="geom_focus_zoom_lock"
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/geometry_focus_zoom_stays_locked"))
            assert result is not None and "before" in result, (
                f"geometry_focus_zoom_stays_locked failed: {result}"
            )
            before, after = result["before"], result["after"]
            assert after is not None, f"zoom moveend never fired within 5s: {result}"
            assert after["marqueeBB"] is not None, (
                f"marquee vanished after zoom: {result}"
            )
            # The marquee is the geometry bbox + 4px pad on all sides.
            pad = 4
            tol = 1.0
            gb, mb = before["geomBB"], before["marqueeBB"]
            assert abs(mb["x"] - (gb["x"] - pad)) <= tol, (
                f"before zoom: marquee left edge {mb['x']} != geom {gb['x']} - pad {pad}"
            )
            assert abs(mb["y"] - (gb["y"] - pad)) <= tol, (
                f"before zoom: marquee top edge {mb['y']} != geom {gb['y']} - pad {pad}"
            )
            gb, mb = after["geomBB"], after["marqueeBB"]
            assert abs(mb["x"] - (gb["x"] - pad)) <= tol, (
                f"AFTER zoom: marquee left edge {mb['x']} != geom {gb['x']} - pad {pad} "
                f"(marquee froze at old position)"
            )
            assert abs(mb["y"] - (gb["y"] - pad)) <= tol, (
                f"AFTER zoom: marquee top edge {mb['y']} != geom {gb['y']} - pad {pad} "
                f"(marquee froze at old position)"
            )
            assert abs(mb["w"] - (gb["w"] + 2 * pad)) <= tol, (
                f"AFTER zoom: marquee width {mb['w']} != geom {gb['w']} + 2*pad"
            )
            assert abs(mb["h"] - (gb["h"] + 2 * pad)) <= tol, (
                f"AFTER zoom: marquee height {mb['h']} != geom {gb['h']} + 2*pad"
            )

    def test_focus_overlay_renderer_lifecycle(self, browser, tmp_path):
        """Each focus owns exactly one SVG renderer in the overlay pane.

        ``L.svg({ pane })`` builds a fresh renderer that mounts its own ``<svg>``
        into the pane, which lives for the whole map's life. ``dismissFocus``
        uses the public Leaflet teardown path (``map.removeLayer`` on the
        renderer), so every focus cycle must leave the pane empty — the pane
        itself persists (ensurePane memoises it), the renderer does not. The
        control-teardown path (``removeControl`` + ``addControl`` on the same
        control, documented in CLAUDE.md) runs ``dismissFocus`` inside
        ``unbindEvents``, so an in-flight focus must not outlive the removal.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            slug="focus_overlay_lifecycle",
        ) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/focus_overlay_renderer_lifecycle"))
            assert result is not None and result.get("ctrl") is True, (
                f"lifecycle probe failed to run: {result}"
            )
            assert result["before"] == 0, (
                f"the overlay pane should start empty: {result}"
            )
            # One renderer per focus, cleanly removed on cancel.
            for cycle in result["cycles"]:
                assert cycle["row"] is True, f"missing row for {cycle['id']}: {cycle}"
                assert cycle["svg"] == 1, (
                    f"focus should mount exactly one SVG renderer: {cycle}"
                )
                assert cycle["rendererLive"] is True, cycle
                assert cycle["after"]["svg"] == 0, (
                    f"cancel must remove the SVG renderer — a non-zero count is a "
                    f"leak: {cycle}"
                )
                assert cycle["after"]["rendererNull"] is True, cycle
            teardown = result["teardown"]
            assert teardown["svgAtRemove"] == 1, (
                f"an in-flight focus must hold one SVG at the moment of "
                f"removeControl: {teardown}"
            )
            assert teardown["svgAfterRemove"] == 0, (
                f"removeControl must dismiss the in-flight focus, leaving no "
                f"leaked renderer: {teardown}"
            )
            assert teardown["svgAfterAdd"] == 0, (
                f"addControl must not resurrect the removed renderer: {teardown}"
            )
            assert not errors, f"JS errors: {errors}"
