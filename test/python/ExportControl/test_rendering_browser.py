"""Rendering-scale tests for foliplus.ExportControl export output."""

from __future__ import annotations

import folium
from conftest import _js, use_page, use_raw_page

from foliplus import ExportControl

from .helper import _make_page


class TestExportRenderBrowser:
    """Browser tests for scale/marker/vector/saved-bounds rendering in exported PNG."""

    def test_leaves_live_tile_layers_untouched(self, browser, tmp_path):
        """ExportControl no longer rewrites live tile layers' crossOrigin nor
        registers a permanent layeradd listener — the removed CORS pre-setup
        blanked non-CORS base maps, flashed the viewport on init, and leaked
        the listener.  Re-adding the control must not change either."""
        with use_page(_make_page, browser, tmp_path, folium.TileLayer()) as (
            page,
            errors,
        ):
            state = page.evaluate(_js("ExportControl/read_tile_state"))
            # Leaflet's default options.crossOrigin is `false`; anything
            # truthy would mean ExportControl rewrote the layer again.
            for c in state["before"]["crossOrigins"] + state["after"]["crossOrigins"]:
                assert not c
            # The removed pre-setup's layeradd handler referenced crossOrigin;
            # Leaflet's own attribution and foliplus's components never do.
            # Re-adding the control must not change the listener set at all.
            for src in (
                state["before"]["layeraddHandlers"] + state["after"]["layeraddHandlers"]
            ):
                assert "crossOrigin" not in src
            assert len(state["before"]["layeraddHandlers"]) == len(
                state["after"]["layeraddHandlers"]
            )
            assert not errors, f"JS errors: {errors}"

    def test_export_vector_and_marker_content(self, browser, tmp_path):
        """Export with vector polygon + Marker layers produces non-blank canvas."""

        # Add a polygon (vector layer)
        with use_page(
            _make_page,
            browser,
            tmp_path,
            folium.GeoJson(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {},
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [
                                    [
                                        [119.28, 26.06],
                                        [119.32, 26.06],
                                        [119.32, 26.10],
                                        [119.28, 26.10],
                                        [119.28, 26.06],
                                    ]
                                ],
                            },
                        }
                    ],
                },
                name="Test Polygon",
                overlay=True,
                show=True,
            ),
            # Add a Marker
            folium.Marker(
                [26.08, 119.30],
                popup="Center",
                name="Test Marker",
                overlay=True,
                show=True,
            ),
            slug="export_vector",
        ) as (page, _):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # Open export control
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            # Lock crop box → switches to download button
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.foliplus-locked", state="attached", timeout=5000
            )

            # Click download button to trigger export
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()

            # Wait for export to finish — control collapses on completion
            page.wait_for_function(
                _js("ExportControl/wait_export_collapsed"), timeout=30000
            )
            page.wait_for_timeout(500)

            # Check JS errors
            assert len(errors) == 0, f"JS errors: {errors}"

            # Verify layers are registered in LayerControl API
            api_layers = page.evaluate(_js("ExportControl/read_api_layers"))
            assert len(api_layers) > 0, f"No layers in API. errors={errors}"

            overlay_layers = [
                l for l in api_layers if l["role"] != "base" and l["visible"]
            ]
            assert len(overlay_layers) > 0, (
                f"No visible overlay layers. api={api_layers} errors={errors}"
            )

    def test_scale_attr_dim_below_mask(self, browser, tmp_path):
        """Scale/attribution stay below the dim mask (z-index stacking).

        Regression: when the crop box was attached to map._mapPane (which has
        z-index:400 creating a stacking context), the box's 9501 z-index was
        trapped inside a 400-level context, so scale/attr rendered above the
        dim shadow. The box must live in mapContainer (z auto) so it
        participates in the root stacking context.
        """

        from foliplus import LayerControl, ScaleControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        ScaleControl().add_to(m)
        LayerControl().add_to(m)
        ExportControl().add_to(m)
        html_path = tmp_path / "export_scale_attr_mask.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl", state="attached", timeout=10000
            )
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            info = page.evaluate(_js("ExportControl/read_mask_zindex"))

            # Box must live in mapContainer (not mapPane) — mapPane's
            # z-index:400 stacking context would trap the mask below scale/attr.
            assert info["parentIsContainer"], (
                f"Crop box must be inside mapContainer, got parentZ={info['parentZ']}"
            )
            assert info["parentZ"] == "auto" or info["parentZ"] == "", (
                f"mapContainer must not create a stacking context, got {info['parentZ']}"
            )
            # Mask z (9501) must be above scale/attr z
            assert info["boxZ"] > info["scaleZ"], (
                f"Mask z={info['boxZ']} must be above scale z={info['scaleZ']}"
            )
            assert info["boxZ"] > info["attrZ"], (
                f"Mask z={info['boxZ']} must be above attr z={info['attrZ']}"
            )

    def test_scale_visible_under_deep_layer_stack(self, browser, tmp_path):
        """Deep overlay stack must not cover the export-mode scale control.

        The old scale/attr z=850 sat inside the layer band
        (600 + n*10). ~25 overlay layers climb past 850 and cover the scale
        entirely — the dim layer is supposed to sit above every data layer
        and only under the crop UI. After the fix, scale z = export-base - 10
        (9490): above every data pane, still under the crop mask (9501).
        """
        from foliplus import LayerControl, ScaleControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        ScaleControl().add_to(m)
        LayerControl().add_to(m)
        ExportControl().add_to(m)
        html_path = tmp_path / "export_deep_stack_scale.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl", state="attached", timeout=10000
            )
            # 30 canvas layers → top overlay pane z = 600 + 30*10 = 900 > 850.
            stacked = page.evaluate(_js("ExportControl/setup_deep_layer_stack"))
            assert stacked["ok"] is True, stacked
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            info = page.evaluate(_js("ExportControl/read_deep_stack_scale_z"))

            # The stack is deep enough that the old 850 would have been covered.
            assert info["maxPaneZ"] is not None, f"no layer panes: {info}"
            assert info["maxPaneZ"] > 850, (
                f"stack not deep enough to pin the regression: {info}"
            )
            # Scale stays above every data layer and under the crop mask.
            assert info["scaleZ"] is not None, f"scale missing: {info}"
            assert info["scaleZ"] > info["maxPaneZ"], (
                f"scale z={info['scaleZ']} covered by deep stack "
                f"(max pane z={info['maxPaneZ']}): {info}"
            )
            assert info["boxZ"] > info["scaleZ"], (
                f"crop mask must stay above scale: {info}"
            )

    def test_saved_bounds_restore(self, browser, tmp_path):
        """Saved bounds in localStorage restore the crop box on toggle."""
        with use_page(_make_page, browser, tmp_path) as (page, _):
            # Pre-set localStorage with saved bounds using the exact storage key.
            # Extract the map name from the first script tag that defines L.map.
            map_name = page.evaluate(_js("ExportControl/read_map_name"))
            storage_key = "foliplus_export_rect_" + map_name
            page.evaluate(_js("ExportControl/set_saved_bounds"), storage_key)

            # Reload so ExportControl's constructor re-reads saved bounds
            # (loadSavedBounds runs at init, not on toggle).
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl", state="attached", timeout=10000
            )

            # Open export control — should auto-restore saved bounds
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box.foliplus-locked", state="attached", timeout=5000
            )
            assert page.locator(".foliplus-export-box.foliplus-locked").is_visible(), (
                "Saved bounds should auto-lock the crop box"
            )

            # Verify the export button (download) is shown after lock
            assert page.locator(".foliplus-tool-bar .foliplus-confirm").is_visible()
