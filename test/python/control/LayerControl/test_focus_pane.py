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

from .helper import _expand_panel, _geo_mixed, _write_html
from .helper_browser import LayerControlBrowserBase


class TestPanelBrowser(LayerControlBrowserBase):
    def test_keydown_escape_keeps_focus_in_row(self, browser, tmp_path):
        """Escape while the row holds DOM focus lifts the cursor class in place.

        The rename-cancel path is covered by the vitest suite; this browser
        probe pins the real-Chromium contract: class off, focus still inside
        the row, no residual suppress marker.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(
                _js("LayerControl/keydown_escape_keeps_focus_in_row")
            )
            assert result is not None, "keydown_escape_keeps_focus_in_row failed"
            assert result["cursorCleared"] is True, (
                "Escape should clear the cursor, got " + str(result)
            )
            assert result["focused"] is True, (
                "Escape must keep DOM focus inside the row, got " + str(result)
            )
            assert result["suppressLeft"] is False, (
                "the FOCUS_SUPPRESSED mechanism is gone, got " + str(result)
            )

    def test_base_basemap_quiet_focus(self, browser, tmp_path):
        """Base basemap / color rows show no cursor glow; overlay rows still do.

        Basemaps are stack slots, not data layers — click / keyboard focus
        must not paint the white+glow recipe. Mouse cursor stays default.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        base = folium.TileLayer("OpenStreetMap", name="OSM", overlay=False)
        with use_page(self._make_page, browser, tmp_path, overlay, base) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            page.mouse.move(0, 0)
            result = page.evaluate(_js("LayerControl/base_basemap_quiet_focus"))
            assert result is not None and "error" not in result, (
                f"base basemap snippet failed: {result}"
            )
            # Checked base row: no glow, not white — keep the visibility wash.
            assert result["baseCheckedHover"]["glow"] is False, (
                "base basemap must not show the cursor glow, got " + str(result)
            )
            assert result["baseCheckedHover"]["cursor"] == "default", (
                "base basemap hover must keep the default cursor, got " + str(result)
            )
            assert result["baseCheckedHover"]["bg"] == result["wash"], (
                "checked base row must keep the wash on hover, got " + str(result)
            )
            assert result["baseCheckedHover"]["bg"] != result["white"], (
                "checked base row must not flash white on hover, got " + str(result)
            )
            # Overlay data row still gets the full recipe.
            assert result["overlayAfter"]["glow"] is True, (
                "overlay row must still show the cursor glow, got " + str(result)
            )
            # Color picker row is quiet when present.
            if result["colorAfter"] is not None:
                assert result["colorAfter"]["glow"] is False, (
                    "color picker row must not show the cursor glow, got " + str(result)
                )

    def test_focus_overlay_pane_keeps_spotlight_visible(self, browser, tmp_path):
        """The focus overlay pane carries both the base and exclusion classes.

        Every foliplus-owned pane goes through ``PaneManager.ensurePane``, so
        the overlay pane carries ``foliplus-layer-pane`` — the semantic marker
        that the pane belongs to us and the interaction rules in focus.css
        apply uniformly. The focused-layer rule
        ``.foliplus-is-focus-mode .foliplus-layer-pane:not(.foliplus-focus-pane)``
        would hide it too without the exclusion tag, so ``drawFocusMask`` adds
        ``foliplus-focus-pane`` alongside the base class. This gate reads the
        pane as the code left it, then toggles the exclusion class to prove
        the risk is real (dropping the tag collapses the spotlight).
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="focus_overlay_pane",
        ) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(
                _js("LayerControl/focus_overlay_pane_hides_with_base_class")
            )
            assert result is not None and result.get("pane") is True, (
                f"focus overlay pane missing after dblclick: {result}"
            )
            assert result["focusActive"] is True, (
                f"container must carry foliplus-is-focus-mode during focus: {result}"
            )
            state = result["state"]
            assert state["base"] is True, (
                "the focus overlay pane must carry the base "
                f"foliplus-layer-pane class: {state}"
            )
            assert state["exclusion"] is True, (
                "the focus overlay pane must carry the foliplus-focus-pane "
                f"exclusion tag so the spotlight is not hidden: {state}"
            )
            assert state["visibility"] == "visible", (
                f"the spotlight pane must stay visible during focus: {state}"
            )
            # Q2 gate: the overlay pane is not in childPaneSpecs, so
            # ensurePane skips its provisional-z branch and drawFocusMask pins
            # FOCUS_Z.overlay itself. Assert the pin held AND that no other
            # owned pane has climbed to or above it — otherwise the mask would
            # be covered by a data layer and the dim would be silent.
            assert state["zIndex"] == "9000", (
                f"focus overlay pane must sit at FOCUS_Z.overlay (9000), got "
                f"{state['zIndex']!r}"
            )
            assert result["maxPeerZ"] < 9000, (
                "no other foliplus-layer-pane may sit at or above the focus "
                f"overlay pane (highest peer z={result['maxPeerZ']})"
            )
            # Risk 1, proven: base class alone would hide the pane.
            assert result["withoutExclusion"] == "hidden", (
                "dropping the exclusion tag must hide the overlay pane — this is "
                f"the risk the exclusion tag neutralises: {result}"
            )
            assert result["restored"] == "visible", (
                f"restoring the tag must make the pane visible again: {result}"
            )

    def test_focus_overlay_pane_click_through(self, browser, tmp_path):
        """The focus overlay pane must not intercept pointer events.

        The base ``foliplus-layer-pane`` class carries ``pointer-events: none``
        from focus.css, so the pane div — which the SVG renderer fills across
        the whole map while a focus is live — never eats a click. Without the
        base class the div defaults to ``auto`` and, sitting above every other
        layer pane, it blocks every hit on the focused layer's own features
        during focus: a silent regression the previous shape of the pane
        produced. This gate pins the CSS invariant directly: drop the base
        class (or the rule) and the assertion fires.
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="focus_overlay_click",
        ) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/focus_overlay_pane_click_through"))
            assert result is not None and result.get("pane") is True, (
                f"focus overlay pane missing after dblclick: {result}"
            )
            assert result["panePointerEvents"] == "none", (
                "the focus overlay pane div must inherit pointer-events: none "
                f"from the base class, got {result['panePointerEvents']!r}"
            )

    def test_focus_keeps_base_panes_visible(self, browser, tmp_path):
        """Basemaps stay visible during focus — they are dimmed, not hidden.

        Before this fix, ``.foliplus-is-focus-mode`` hid every
        ``.foliplus-layer-pane`` except the focused one. The active basemap
        (topmost base layer that is effectiveShown) is exempted via
        `.foliplus-focus-basemap` and stays visible; other base panes and
        overlay data panes are hidden so the focused layer stands out. The
        dim mask on top preserves spatial context.

        The color basemap is created lazily on first show, so we toggle its
        checkbox on before focusing — this also exercises the ``!layer``
        branch of the ordering pass (color basemaps have no Leaflet layer).
        """
        # A tile basemap + an overlay polygon so focus has a target.
        base = folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="OSM",
            attr="OSM",
            overlay=False,
        )
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            base,
            fg,
            slug="focus_keeps_base_visible",
        ) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            # Turn the color basemap on so its lazily-created pane is in the
            # DOM before we focus.
            toggle = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert toggle is not None and toggle.get("ok") is True, toggle
            page.wait_for_timeout(200)
            result = page.evaluate(_js("LayerControl/focus_keeps_base_panes_visible"))
            assert result is not None and not result.get("error"), (
                f"focus probe failed: {result}"
            )
            assert result["focusActive"] is True, f"focus mode must be active: {result}"
            assert result["maskPanePresent"] is True, (
                f"focus mask pane must exist: {result}"
            )
            # Classify the panes: active basemap, focused layer, and others.
            focus_basemap_panes = [p for p in result["panes"] if p["focusBasemap"]]
            focus_panes = [p for p in result["panes"] if p["focusExcl"]]
            other_panes = [
                p
                for p in result["panes"]
                if not p["focusBasemap"] and not p["focusExcl"]
            ]
            # The active basemap must be present and visible.
            assert len(focus_basemap_panes) >= 1, (
                "the active basemap's pane must be present and marked with "
                f"foliplus-focus-basemap: {result['panes']}"
            )
            for pane in focus_basemap_panes:
                assert pane["visibility"] == "visible", (
                    "the active basemap's pane must stay visible during focus "
                    f"— the dim mask does the dimming, not visibility:hidden: "
                    f"{pane}"
                )
            # The focused layer's pane and the focus overlay pane must be
            # visible.
            assert len(focus_panes) >= 2, (
                "the focused layer's pane and the focus overlay pane must both "
                f"carry foliplus-focus-pane: {result['panes']}"
            )
            for pane in focus_panes:
                assert pane["visibility"] == "visible", (
                    f"a foliplus-focus-pane pane must stay visible: {pane}"
                )
            # Any other pane (including non-active base panes and overlay data
            # layers) must be hidden — otherwise the focused layer is not
            # visually isolated.
            for pane in other_panes:
                assert pane["visibility"] == "hidden", (
                    "a non-focus, non-active-basemap foliplus-layer-pane must "
                    f"be hidden during focus so the focused layer stands out: "
                    f"{pane}"
                )

    def test_focus_basemap_dim_direction(self, browser, tmp_path):
        """The focused basemap interior must NOT be darker than unfocused.

        The dim rule uses `opacity`, which blends the basemap toward the map
        container's background color — the result is lighter, not darker.
        A `filter: brightness(...)` would darken the pane uniformly (including
        the interior), which is the wrong direction: the user expects the
        basemap to fade into the background, not to sink into shadow. This
        pixel-level gate catches a regression where someone changes the rule
        back to a filter.

        The test enables the solid-color basemap because OSM tiles are 404 in
        browser tests — a transparent tile pane makes `opacity` a no-op on the
        pixel, so the gate cannot distinguish the two rules. It samples a pixel
        in the focus rectangle's padding ring: outside the polygon (no overlay
        contamination) but inside the focus rect (no mask), so the delta
        reflects only the basemap's opacity change. The padding ring is 32px
        (FOCUS.PADDING); 15px inside it gives a comfortable margin.
        """
        base = folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="OSM",
            attr="OSM",
            overlay=False,
        )
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            base,
            fg,
            slug="focus_basemap_direction",
        ) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            # Pan the map to center the polygon so the sample point is inside
            # the viewport. The polygon's top edge is north of the default map
            # center; without panning, the padding-ring sample would be above
            # the viewport (negative y) and the pixel read would be out-of-bounds.
            page.evaluate(_js("LayerControl/pan_to_foliplus"))
            page.wait_for_timeout(500)

            # Enable the solid-color basemap so there is a visible basemap to
            # dim. OSM tiles are 404 in browser tests, so the tile pane is
            # transparent and `opacity` on it would have no visible effect.
            color_result = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert color_result.get("ok") is True, (
                f"failed to enable color basemap: {color_result}"
            )
            # Wait for the color basemap canvas to paint.
            page.wait_for_timeout(300)

            import io

            from PIL import Image

            # Sample the polygon center — inside the polygon (definitely inside
            # the focus rect, so the mask does not apply) and on the basemap
            # underneath (the polygon's fill_opacity=0.5 lets the basemap show
            # through at 50%). The pixel is a blend of polygon fill and basemap;
            # the delta comes only from the basemap's opacity change.
            box = page.evaluate(_js("LayerControl/project_foliplus_latlng"))
            px, py = int(box["x"]), int(box["y"])

            # Capture before focus.
            screenshot_before = page.screenshot()
            img_before = Image.open(io.BytesIO(screenshot_before))
            pixel_before = img_before.getpixel((px, py))

            # Trigger focus by dblclicking the first overlay layer row.
            result = page.evaluate(_js("LayerControl/focus_keeps_base_panes_visible"))
            assert result is not None and not result.get("error"), (
                f"focus probe failed: {result}"
            )
            assert result["focusActive"] is True, f"focus mode must be active: {result}"

            # Capture after focus.
            page.wait_for_timeout(200)  # let the opacity transition settle
            screenshot_after = page.screenshot()
            img_after = Image.open(io.BytesIO(screenshot_after))
            pixel_after = img_after.getpixel((px, py))

            # The focused basemap interior must not be darker than unfocused.
            # With opacity, the pixel blends toward the container background
            # (#ddd ≈ 221), so the focused pixel is lighter. With a filter,
            # it would be darker.
            before_r, before_g, before_b = pixel_before[:3]
            after_r, after_g, after_b = pixel_after[:3]
            for channel, b, a in [
                ("R", before_r, after_r),
                ("G", before_g, after_g),
                ("B", before_b, after_b),
            ]:
                delta = a - b
                assert delta >= 0, (
                    f"the focused basemap interior must not be darker than "
                    f"unfocused in channel {channel}: before={b}, after={a}, "
                    f"delta={delta} — the dim rule must use `opacity` "
                    f"(which blends toward the container background), not "
                    f"`filter` (which darkens uniformly)"
                )

    def test_focus_closes_map_popup(self, browser, tmp_path):
        """A feature-bound Leaflet popup (folium GeoJsonPopup) closes when
        focusLayer runs — closeOverlays sweeps eachLayer so the popup
        survives on a sublayer-bound surface (not just map._popup) is still
        dropped.

        This is the end-to-end repro of the original bug: click a GeoJson
        feature to open its popup, then focus the layer, and the popup must
        disappear. jsdom/vitest cannot verify this because map is a mock;
        only a real Leaflet map proves the sweep closes the popup.
        """
        fg = folium.FeatureGroup(name="Features", overlay=True, show=True)
        folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "polygon_zone_a")),
            name="GeoJson",
            layer_name="GeoJson",
            popup=folium.GeoJsonPopup(
                fields=["name", "value"],
                aliases=["Name", "Value"],
            ),
        ).add_to(fg)

        with use_page(self._make_page, browser, tmp_path, fg, slug="popup_focus") as (
            page,
            errors,
        ):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/popup_closes_on_focus"))
            assert result is not None and "error" not in result, (
                f"popup_closes_on_focus snippet failed: {result}"
            )
            # The popup must have opened on feature click.
            assert result["popupOpenBefore"] is True, (
                f"popup did not open on feature click: {result}"
            )
            # After focus, the popup must be gone.
            assert result["popupStillOpen"] is False, f"popup survived focus: {result}"
            # Focus must be active — proves closeOverlays ran, not a no-op.
            assert result["focusing"] is True, f"focus did not activate: {result}"
            assert not errors, f"JS errors: {errors}"

    def test_focus_hides_native_ui_panes(self, browser, tmp_path):
        """Focus-mode CSS hides Leaflet's remaining UI panes: hover tooltips
        and popups — and, through the layer-pane rule, every non-focused
        marker layer's shadows.

        Marker shadows are foliplus panes now: each marker layer carries its
        own shadow pane (`PaneRole.SHADOW`, `PaneManager.pinLateContent`
        moves `_shadow` in and writes `options.shadowPane`), so the
        `.foliplus-layer-pane` hide rule reaches them and the focused layer's
        own shadows stay in its spotlight. The blanket
        `.leaflet-shadow-pane { visibility: hidden }` rule this test used to
        pin is gone — it was the workaround for shadows living outside any
        layer pane, and it took the focused marker layer's shadows down with
        everyone else's. Hover tooltips and popups still live in Leaflet's
        own `leaflet-{tooltip,popup}-pane` divs, so their two dedicated
        selectors in `focus.css` each `visibility: hidden` under
        `.foliplus-is-focus-mode`; `dismissFocus`'s class removal restores
        them. Companion teardown sweeps `.leaflet-tooltip` alongside
        `.leaflet-popup` so hover residue does not reappear on hover-out
        after focus ends.

        The probe drives focus by dblclicking the polygon row and samples
        `getComputedStyle(pane).visibility` before, during, and after. The
        tooltip is opened programmatically via `openTooltip()` (hover timing
        is unreliable in headless) and the marker layer's shadow pane is
        seeded with a synthetic shadow — folium's default awesome-marker
        icon does not carry a shadow, but the CSS rule is pane-scoped so the
        element inside just has to exist for the assertion to be meaningful.
        """
        # Polygon layer: focus target. Marker layer: produces a tooltip on
        # hover, and its shadow pane hosts the seeded probe element.
        fg_polygon = folium.FeatureGroup(name="Zones", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg_polygon)
        fg_marker = folium.FeatureGroup(name="Points", overlay=True, show=True)
        folium.Marker([26.05, 119.25], name="P1", tooltip="Tooltip text").add_to(
            fg_marker
        )

        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg_polygon,
            fg_marker,
            slug="focus_native_panes",
        ) as (page, errors):
            panel_ready(page)

            # Expose the test marker to the snippet so it can `openTooltip()`
            # deterministically, and so the probe can locate the marker
            # layer's shadow pane. The var name is the folium hash suffix.
            marker_var = page.evaluate(_js("LayerControl/find_marker_var"))
            assert marker_var is not None, "could not find the folium marker var"
            page.evaluate(_js("LayerControl/set_test_marker"), marker_var)

            result = page.evaluate(_js("LayerControl/focus_hides_native_panes"))
            assert result is not None and "error" not in result, (
                f"focus_hides_native_panes snippet failed: {result}"
            )
            shadow_pane_id = result.get("shadowPaneId")
            assert shadow_pane_id, (
                f"marker layer shadow pane not found: {result['shadowPaneId']}"
            )

            # Pre-focus: the seeded shadow is in the marker layer's shadow
            # pane and the opened tooltip is in the DOM, so the hide
            # assertions below aren't vacuous.
            assert result["before"]["shadowProbe"]["present"] is True, (
                "the marker layer's shadow pane must carry the seeded probe "
                f"element before focus (else the assertions are vacuous): "
                f"{result['before']}"
            )
            assert result["before"]["shadowProbe"]["visibility"] == "visible", (
                f"shadow probe must be visible before focus: {result['before']}"
            )
            assert result["before"]["tooltipEl"] is True, (
                f"openTooltip() must have produced a .leaflet-tooltip element "
                f"before focus: {result['before']}"
            )
            assert result["before"]["containerFocus"] is False, (
                "focus must not be active before the dblclick"
            )

            # During focus: the two native UI panes must be `visibility:
            # hidden` (their dedicated rules), and the non-focused marker
            # layer's shadow pane must be hidden through the layer-pane rule —
            # while Leaflet's shared shadow pane stays visible: the blanket
            # hide is gone, and a focused marker layer keeps its own shadows.
            assert result["during"]["containerFocus"] is True, (
                f"focus mode did not activate: {result['during']}"
            )
            for name in ("tooltipPane", "popupPane"):
                pane = result["during"][name]
                assert pane["present"] is True, f"{name} must exist on the map: {pane}"
                assert pane["visibility"] == "hidden", (
                    f"{name} must be `visibility: hidden` during focus "
                    f"— focus.css must hide Leaflet's own UI panes: {pane}"
                )
            marker_shadow_pane = result["during"]["markerShadowPane"]
            assert marker_shadow_pane["present"] is True, (
                f"marker layer shadow pane must exist on the map: {marker_shadow_pane}"
            )
            assert marker_shadow_pane["visibility"] == "hidden", (
                "the non-focused marker layer's shadow pane must be hidden "
                f"during focus through the layer-pane rule: {marker_shadow_pane}"
            )
            assert result["during"]["shadowProbe"]["visibility"] == "hidden", (
                f"the seeded shadow must be hidden with its pane: {result['during']}"
            )
            shared_shadow_pane = result["during"]["shadowPane"]
            assert shared_shadow_pane["present"] is True, (
                f"Leaflet's shared shadow pane must exist on the map: {shared_shadow_pane}"
            )
            assert shared_shadow_pane["visibility"] == "visible", (
                "Leaflet's shared shadow pane must NOT be hidden during focus "
                f"— the blanket hide rule is removed: {shared_shadow_pane}"
            )

            # After cancel: the `.foliplus-is-focus-mode` class must be gone,
            # so the CSS rule releases the panes. The tooltip DOM element may
            # have been removed by `closeOverlays`' `.leaflet-tooltip` sweep
            # during focus (intentional — hover residue must not resurrect on
            # hover-out after focus ends), so only the container focus and
            # the shadow-pane restoration are asserted.
            assert result["after"]["containerFocus"] is False, (
                f"focus mode must be released after cancelFocus: {result['after']}"
            )
            assert result["after"]["markerShadowPane"]["present"] is True, (
                f"marker layer shadow pane must survive cancelFocus: {result['after']}"
            )
            assert result["after"]["markerShadowPane"]["visibility"] == "visible", (
                f"marker layer shadow pane must be restored to `visibility: "
                f"visible` after focus is cancelled: {result['after']}"
            )
            assert result["after"]["shadowProbe"]["visibility"] == "visible", (
                f"the seeded shadow must be visible again after cancelFocus: "
                f"{result['after']}"
            )
            assert not errors, f"JS errors: {errors}"
