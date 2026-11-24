"""Browser tests for the focus overlay: dim direction, base-pane visibility and popup handling."""

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
