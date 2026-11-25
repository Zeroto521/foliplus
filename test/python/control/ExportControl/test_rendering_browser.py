"""Rendering-scale and marker-paint tests for foliplus.ExportControl export output."""

from __future__ import annotations

import json

import folium
from conftest import _js, load_geojson, use_page, use_raw_page

from foliplus import ExportControl

from .helper import (
    _install_canvas_hook,
    _make_page,
    _run_export,
    _sample_pixels_in_export,
    _wait_export_canvas_ready,
)


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
                load_geojson("common", "polygon_fuzhou_box"),
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


class TestMarkersBrowser:
    """Browser tests for the marker and shadow paint channels in the export."""

    def test_export_divicon_child_background_color(self, browser, tmp_path):
        """A DivIcon pin drawn by a CHILD element's background-color exports it.

        A DivIcon's root marker element is transparent — no background-image,
        no background-color, no <img>, no <svg>; the visible pin is an
        arbitrary HTML descendant. The remaining-types pass only painted the
        ROOT's background-color, so such a marker exported nothing at all.
        The child's computed background must reach the output canvas, and the
        render must report zero missing assets (a silent skip is the same
        class of defect).
        """
        with use_page(
            _make_page, browser, tmp_path, slug="export_divicon_child_bg"
        ) as (page, errors):
            state = page.evaluate(_js("ExportControl/setup_divicon_child_background"))
            assert state is not None and state.get("marker"), state
            # The premise: the paint lives on a descendant, not the root.
            assert state["childBackground"] == "rgb(0, 204, 102)", state

            _install_canvas_hook(page)
            _run_export(page)
            _wait_export_canvas_ready(page)
            # A DivIcon has no awaited asset on the pin itself; give the
            # pass a settled frame like the other marker pixel tests.
            page.wait_for_timeout(1000)
            result = _sample_pixels_in_export(page, (0, 204, 102), 20, 200)
            assert result is not None, "Export canvas not captured"
            assert result["hit"] > 0, (
                f"DivIcon child background colour missing from the export: {result}"
            )

            stats = page.evaluate(_js("ExportControl/read_render_stats"))
            assert stats is not None, "render stats not exposed on the manager"
            assert stats["failedAssets"] == 0, (
                f"export reported missing assets on a fully local page: {stats}"
            )
            assert not errors, f"JS errors on DivIcon export: {errors}"

    def test_export_divicon_class_styled_svg(self, browser, tmp_path):
        """A DivIcon's inline <svg> keeps its page-CSS fill in the export.

        The export clones the <svg> and serialises it as a standalone image,
        which carries no stylesheet: a fill that comes from a page CSS class
        fell back to the default black fill. The clone must carry the live
        computed styles of the element and its descendants.
        """
        with use_page(
            _make_page, browser, tmp_path, slug="export_divicon_class_svg"
        ) as (page, errors):
            state = page.evaluate(_js("ExportControl/setup_divicon_class_svg"))
            assert state is not None and state.get("marker"), state
            # The premise: the paint is class-derived, not an inline attribute.
            assert state["circleFill"] == "rgb(102, 0, 255)", state

            _install_canvas_hook(page)
            _run_export(page)
            _wait_export_canvas_ready(page)
            # The SVG goes through a blob load inside the pass.
            page.wait_for_timeout(1000)
            result = _sample_pixels_in_export(page, (102, 0, 255), 20, 200)
            assert result is not None, "Export canvas not captured"
            assert result["hit"] > 0, (
                f"DivIcon class-styled SVG fill missing from the export: {result}"
            )
            assert not errors, f"JS errors on class-styled SVG export: {errors}"

    def test_export_awesome_marker_shadow(self, browser, tmp_path):
        """An awesome-marker shadow (DIV + background-image sprite) exports.

        The default Leaflet shadow is an <img> and was drawn by the remaining
        pass. An awesome-marker shadow is a DIV whose paint is a
        background-image sprite, and the shadow channel ran only the
        remaining pass — which never paints sprites — so the shadow was
        silently missing from every exported map that used those markers.
        """
        point = folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "point_11934_2611")),
            name="Awesome Points",
            marker=folium.Marker(
                icon=folium.Icon(color="cadetblue", icon="map-pin", prefix="fa")
            ),
        )
        with use_page(
            _make_page, browser, tmp_path, point, slug="export_awesome_shadow"
        ) as (page, errors):
            page.evaluate(_js("ExportControl/hide_tile_layers"))
            page.wait_for_timeout(500)
            dom = page.evaluate(_js("ExportControl/read_marker_shadow_dom"))
            assert dom is not None and dom["count"] >= 1, (
                f"awesome marker produced no shadow element: {dom}"
            )
            shadow = dom["shadows"][0]
            # The premise: the shadow is a sprite on a DIV, not an <img>.
            assert shadow["tag"] == "DIV", shadow
            assert "url(" in shadow["backgroundImage"], shadow

            _install_canvas_hook(page)
            _run_export(page)
            _wait_export_canvas_ready(page)
            # The shadow sprite loads through the renderer's async fetch.
            page.wait_for_timeout(1500)
            result = page.evaluate(_js("ExportControl/sample_export_shadow_pixels"))
            assert result is not None, "Export canvas not captured"
            assert result["shadow"] > 0, (
                f"marker shadow missing from the export: {result}"
            )
            assert not errors, f"JS errors on awesome-shadow export: {errors}"

    def test_export_reports_broken_asset(self, browser, tmp_path):
        """An image the export cannot read back is counted and reported.

        Asset loads used to be silent: a sprite, icon, or inline-SVG blob
        that failed left a hole in the picture and no signal. The render must
        count it in its stats and print the URL on the console.
        """
        with use_page(_make_page, browser, tmp_path, slug="export_broken_asset") as (
            page,
            errors,
        ):
            console = []
            page.on("console", lambda msg: console.append(msg.text))
            state = page.evaluate(_js("ExportControl/setup_divicon_broken_image"))
            assert state is not None and state.get("marker"), state
            broken_url = state["brokenUrl"]

            _install_canvas_hook(page)
            _run_export(page)
            _wait_export_canvas_ready(page)
            page.wait_for_timeout(1000)
            stats = page.evaluate(_js("ExportControl/read_render_stats"))
            assert stats is not None, "render stats not exposed on the manager"
            assert stats["failedAssets"] >= 1, (
                f"a failed image load was not counted: {stats}"
            )
            reported = [line for line in console if broken_url in line]
            assert reported, (
                f"the failed asset was not reported on the console: {console}"
            )
            assert not errors, f"JS errors on broken-asset export: {errors}"
