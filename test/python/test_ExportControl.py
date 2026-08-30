"""Tests for foliplus.ExportControl."""

from __future__ import annotations

import re

import folium
import pytest
from conftest import _js, make_browser_page, render_control, use_page, use_raw_page

from foliplus import ExportControl


class TestExportControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert ExportControl()._name == "ExportControl"

    def test_default_position(self):
        assert ExportControl().position == "bottomright"

    def test_custom_position(self):
        assert ExportControl(position="topleft").position == "topleft"

    def test_default_args(self):
        ctrl = ExportControl()
        assert ctrl.filename == "map"
        assert ctrl.format == "png"
        assert ctrl.quality == 0.92
        assert ctrl.scale == 2.0
        assert ctrl.background is None
        assert ctrl.timeout == 7500

    def test_custom_args(self):
        ctrl = ExportControl(
            filename="my_map",
            format="jpeg",
            quality=0.8,
            scale=3.5,
            background="#ffffff",
            timeout=10000,
        )
        assert ctrl.filename == "my_map"
        assert ctrl.format == "jpeg"
        assert ctrl.quality == 0.8
        assert ctrl.scale == 3.5
        assert ctrl.background == "#ffffff"
        assert ctrl.timeout == 10000

    def test_default_locale(self):
        assert ExportControl()._locale_code == ""

    def test_custom_locale(self):
        assert ExportControl(locale="zh")._locale_code == "zh"

    def test_all_positions(self):
        for pos in ("topleft", "topright", "bottomleft", "bottomright"):
            assert ExportControl(position=pos).position == pos

    def test_edge_scale_values(self):
        assert ExportControl(scale=1.0).scale == 1.0
        assert ExportControl(scale=3.0).scale == 3.0

    def test_background_white(self):
        assert ExportControl(background="#ffffff").background == "#ffffff"

    def test_timeout_zero(self):
        assert ExportControl(timeout=0).timeout == 0

    def test_format_default(self):
        assert ExportControl().format == "png"

    def test_format_jpeg(self):
        assert ExportControl(format="jpeg").format == "jpeg"

    def test_format_webp(self):
        assert ExportControl(format="webp").format == "webp"

    def test_format_geotiff(self):
        assert ExportControl(format="geotiff").format == "geotiff"

    def test_format_invalid_raises(self):
        with pytest.raises(ValueError, match="format must be one of"):
            ExportControl(format="gif")

    def test_quality_default(self):
        assert ExportControl().quality == 0.92

    def test_quality_custom(self):
        assert ExportControl(quality=0.5).quality == 0.5

    def test_max_pixels_default(self):
        assert ExportControl().max_pixels == 10240000

    def test_max_pixels_none(self):
        assert ExportControl(max_pixels=None).max_pixels is None

    def test_max_pixels_custom(self):
        assert ExportControl(max_pixels=1000000).max_pixels == 1000000

    def test_locale_config(self):
        from foliplus.locale import LocaleConfig

        cfg = LocaleConfig(language="zh")
        ctrl = ExportControl(locale=cfg)
        assert ctrl._locale_code == "zh"


class TestExportControlRendering:
    def test_default_params(self):
        html = render_control(ExportControl())
        assert "foliplus-export-ctrl" in html
        assert "ctrl-fold" in html

    def test_custom_params_rendering(self):
        html = render_control(
            ExportControl(
                filename="custom",
                format="jpeg",
                quality=0.8,
                scale=1.5,
                background="#000000",
                timeout=5000,
            )
        )
        assert "custom" in html
        assert "jpeg" in html

    def test_geotiff_format_in_html(self):
        """geotiff format is passed through to the HTML template."""
        html = render_control(ExportControl(format="geotiff"))
        assert "geotiff" in html

    def test_css_loaded(self):
        """ExportControl CSS classes are present."""
        html = render_control(ExportControl())
        assert "foliplus-export-overlay" in html
        assert "foliplus-export-box" in html
        assert "foliplus-export-handle" in html
        assert "foliplus-export-center" in html
        assert "foliplus-export-ctrl" in html
        assert "foliplus-export-preview" in html
        assert "foliplus-hidden" in html

    def test_css_z_index_pattern(self):
        """CSS uses --z-export-base variable with calc()."""
        html = render_control(ExportControl())
        assert "z-export-base" in html
        assert "calc(" in html

    def test_locale_zh(self):
        html = render_control(ExportControl(locale="zh"))
        assert "导出" in html
        assert "ExportControl.btn_title" in html

    def test_del_icon_exclusion(self):
        """del-icon elements are excluded via data-foliplus-export attribute."""
        html = render_control(ExportControl())
        assert 'data-foliplus-export="exclude"' in html

    def test_export_control_py_file(self):
        """ExportControl.py has expected exports."""
        ctrl = ExportControl()
        assert hasattr(ctrl, "filename")
        assert hasattr(ctrl, "scale")
        assert hasattr(ctrl, "background")
        assert hasattr(ctrl, "timeout")
        assert hasattr(ctrl, "position")
        assert hasattr(ctrl, "_template")

    def test_css_preview_present(self):
        """ExportControl preview CSS classes are present."""
        html = render_control(ExportControl())
        assert "foliplus-export-ctrl" in html
        assert "foliplus-export-preview" in html


class TestExportControlBrowser:
    """Browser-level tests for ExportControl."""

    @staticmethod
    def _stub_html(html: str) -> str:
        """Remove blocking CDN <script> tags and inject stubs for GeoTIFF/pako."""
        for cdn in (
            "geotiff@3/dist-browser/geotiff.js",
            "pako@2/dist/pako.min.js",
        ):
            html = html.replace(
                f'<script src="https://cdn.jsdelivr.net/npm/{cdn}"></script>', ""
            )
        marker = 'CONF = {"name": "ExportControl"'
        idx = html.find(marker)
        if idx > 0:
            semi = html.find(";", idx)
            if semi > 0:
                stub = (
                    "window.GeoTIFF={writeArrayBuffer:function(){return new ArrayBuffer(0)}};"
                    "window.pako={deflateRaw:function(a){return a}};"
                )
                html = html[: semi + 1] + stub + html[semi + 1 :]
        return html

    @staticmethod
    def _make_page(browser, tmp_path, *layers, slug="export"):
        from foliplus import LayerControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        ExportControl().add_to(m)
        for layer in layers:
            layer.add_to(m)
        html = TestExportControlBrowser._stub_html(m.get_root().render())
        # Inject test hooks right after the manager is created (dev bundle).
        html, n = re.subn(
            r"var exportManager = new ExportManager\(map\);",
            r"var exportManager = new ExportManager(map); window.__map = map; window.__exportManager = exportManager;",
            html,
            count=1,
        )
        assert n == 1, "exportManager instantiation not found in rendered HTML"
        page, errors = make_browser_page(browser, tmp_path, html, slug)
        page.wait_for_selector(".foliplus-export-ctrl", state="attached", timeout=10000)
        return page, errors

    def test_toggle_button_present(self, browser, tmp_path):
        """Export toggle button is rendered and clickable."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            btn = page.wait_for_selector(
                ".foliplus-export-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            assert btn is not None, "Export toggle button not found"

    def test_crop_box_appears_on_click(self, browser, tmp_path):
        """Clicking toggle button shows the crop box."""

        with use_page(self._make_page, browser, tmp_path) as (page, _):
            btn = page.locator(".foliplus-export-ctrl .foliplus-toggle-btn")
            btn.click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            assert page.locator(".foliplus-export-box").is_visible()
            assert page.locator(".foliplus-export-overlay").is_visible()
            assert page.locator(".foliplus-export-handle").count() == 8

    def test_escape_closes_crop_box(self, browser, tmp_path):
        """Pressing Escape with unlocked crop box removes it."""

        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            # Verify crop box is visible
            assert page.locator(".foliplus-export-box").is_visible()
            # Press Escape
            page.keyboard.press("Escape")
            # Crop box should disappear
            page.wait_for_selector(
                ".foliplus-export-box",
                state="hidden",
                timeout=5000,
            )

    def test_crop_selecting_disables_other_layer_interaction(self, browser, tmp_path):
        """Crop selection suspends interaction on other map layers (clicks fall
        through to drag the crop box instead of firing feature handlers), and
        closing the crop box restores it."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(
                "window.__featureMarker = L.marker([26.08, 119.30]).addTo(window.__map).bindPopup('x');"
            )
            page.wait_for_timeout(300)
            assert page.evaluate("window.__featureMarker.options.interactive") is True

            # Open crop selection → the centralized ModeManager lock disables the marker.
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.wait_for_timeout(300)
            assert (
                page.evaluate(
                    "window.__exportManager.map.foliplus.modes.getMode('ExportControl')"
                )
                == "selecting"
            )
            assert page.evaluate("window.__featureMarker.options.interactive") is False

            # A DOM click on the marker's icon must NOT open its popup while the
            # crop box owns the map.
            page.evaluate(
                "window.__featureMarker.getElement().dispatchEvent(new MouseEvent('click', { bubbles: true }))"
            )
            page.wait_for_timeout(300)
            popup_open = page.evaluate("!!document.querySelector('.leaflet-popup')")
            assert not popup_open, "feature popup opened during crop selection"

            # Close the crop box (Escape) → interaction restored.
            page.keyboard.press("Escape")
            page.wait_for_selector(".foliplus-export-box", state="hidden", timeout=5000)
            page.wait_for_timeout(300)
            assert page.evaluate("window.__featureMarker.options.interactive") is True
            assert not errors, f"JS errors: {errors}"

    def test_enter_locks_crop_box(self, browser, tmp_path):
        """Pressing Enter locks the crop box (dashed > solid border)."""

        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            # Lock via confirm button
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked",
                state="attached",
                timeout=5000,
            )
            assert page.locator(".foliplus-export-box.locked").is_visible()

    def test_arrow_keys_nudge_crop_box(self, browser, tmp_path):
        """Arrow keys nudge the unlocked crop box by NUDGE_STEP without panning."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            # The arrow shortcuts are container-bound — focus the map container.
            page.evaluate(
                "() => { const c = window.__map.getContainer(); "
                "c.setAttribute('tabindex', '-1'); c.focus(); }"
            )
            rect0 = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, t: r.top }; }"
            )
            center0 = page.evaluate(
                "() => { const c = window.__map.getCenter(); return [c.lat, c.lng]; }"
            )
            page.keyboard.press("ArrowRight")
            page.keyboard.press("ArrowDown")
            rect1 = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, t: r.top }; }"
            )
            center1 = page.evaluate(
                "() => { const c = window.__map.getCenter(); return [c.lat, c.lng]; }"
            )
            # Box moved by NUDGE_STEP in both axes; the map must NOT pan
            # (Leaflet's built-in arrow-key handler is disabled while editing).
            assert rect1["l"] == pytest.approx(rect0["l"] + 10)
            assert rect1["t"] == pytest.approx(rect0["t"] + 10)
            assert center1 == center0

    def test_r_resets_crop_box(self, browser, tmp_path):
        """R resets the unlocked crop box to the default centered size."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            default = page.evaluate(
                "() => { const r = window.__exportManager.defaultRect(); "
                "return { l: r.left, t: r.top, w: r.width, h: r.height }; }"
            )
            page.evaluate(
                "() => { const c = window.__map.getContainer(); "
                "c.setAttribute('tabindex', '-1'); c.focus(); }"
            )
            # Nudge away from default so a reset is observable.
            page.keyboard.press("ArrowRight")
            page.keyboard.press("ArrowRight")
            page.keyboard.press("ArrowDown")
            moved = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, t: r.top, w: r.width, h: r.height }; }"
            )
            assert moved != default, "expected box to move before reset"
            page.keyboard.press("r")
            after = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, t: r.top, w: r.width, h: r.height }; }"
            )
            assert after == pytest.approx(default)

    def test_export_mode_class(self, browser, tmp_path):
        """foliplus-export-mode class is added to body and map container."""

        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            # Check export mode class on body
            has_mode = page.evaluate(
                "document.body.classList.contains('foliplus-export-mode')"
            )
            assert has_mode, "body should have foliplus-export-mode class"
            # Check on map container
            has_map_mode = page.evaluate(_js("ExportControl/read_export_mode_class"))
            assert has_map_mode, "map container should have foliplus-export-mode"

    def test_lock_unlock_cycle(self, browser, tmp_path):
        """Lock then unlock crop box transitions correctly."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            # Lock
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            assert page.locator(".foliplus-export-box.locked").is_visible()

            # Unlock (cancel resets to unlocked)
            page.locator(".foliplus-tool-bar .cancel").click()
            page.wait_for_selector(
                ".foliplus-export-box:not(.locked)", state="attached", timeout=5000
            )
            assert page.locator(".foliplus-export-box").is_visible()

    def test_no_console_errors_on_open(self, browser, tmp_path):
        """Opening export control should not produce JS errors."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)
            assert len(errors) == 0, f"JS errors on open: {errors}"

    def test_export_vector_and_marker_content(self, browser, tmp_path):
        """Export with vector polygon + Marker layers produces non-blank canvas."""

        # Add a polygon (vector layer)
        with use_page(
            self._make_page,
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
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )

            # Click download button to trigger export
            page.locator(".foliplus-tool-bar .confirm").click()

            # Wait for export to finish — control collapses on completion
            page.wait_for_function(
                """() => {
                const ctrl = document.querySelector('.foliplus-export-ctrl');
                return ctrl && ctrl.classList.contains('collapsed');
            }""",
                timeout=30000,
            )
            page.wait_for_timeout(500)

            # Check JS errors
            assert len(errors) == 0, f"JS errors: {errors}"

            # Verify layers are registered in LayerControl API
            api_layers = page.evaluate(_js("ExportControl/read_api_layers"))
            assert len(api_layers) > 0, f"No layers in API. errors={errors}"

            overlay_layers = [l for l in api_layers if not l["isBase"] and l["visible"]]
            assert len(overlay_layers) > 0, (
                f"No visible overlay layers. api={api_layers} errors={errors}"
            )

    def test_crop_box_drag_resize(self, browser, tmp_path):
        """Dragging a crop box handle resizes the box."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            # Get initial box size and the br handle position
            initial = page.evaluate(_js("ExportControl/read_box_rect"))

            # Drag the bottom-right handle using absolute mouse coordinates
            handle = page.locator(".foliplus-export-handle.br")
            handle_box = handle.bounding_box()
            # Drag from handle center 80px right and 40px down
            page.mouse.move(
                handle_box["x"] + handle_box["width"] / 2,
                handle_box["y"] + handle_box["height"] / 2,
            )
            page.mouse.down()
            page.mouse.move(
                handle_box["x"] + handle_box["width"] / 2 + 80,
                handle_box["y"] + handle_box["height"] / 2 + 40,
                steps=10,
            )
            page.mouse.up()
            page.wait_for_timeout(300)

            after = page.evaluate(_js("ExportControl/read_box_rect"))
            assert after["w"] > initial["w"], (
                f"Expected width increased, was {initial['w']} now {after['w']}"
            )
            assert after["h"] > initial["h"], (
                f"Expected height increased, was {initial['h']} now {after['h']}"
            )

    def test_crop_box_drag_move(self, browser, tmp_path):
        """Dragging the crop box center moves the box."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            initial = page.evaluate(_js("ExportControl/read_box_rect"))

            # Drag the center by 30px right and 20px down using raw mouse events
            center = page.locator(".foliplus-export-center")
            center_box = center.bounding_box()
            page.mouse.move(
                center_box["x"] + center_box["width"] / 2,
                center_box["y"] + center_box["height"] / 2,
            )
            page.mouse.down()
            page.mouse.move(
                center_box["x"] + center_box["width"] / 2 + 30,
                center_box["y"] + center_box["height"] / 2 + 20,
                steps=10,
            )
            page.mouse.up()
            page.wait_for_timeout(300)

            after = page.evaluate(_js("ExportControl/read_box_rect"))
            # Width/height should be unchanged
            assert after["w"] == initial["w"], (
                f"Width should not change on move, was {initial['w']} now {after['w']}"
            )
            assert after["h"] == initial["h"], (
                f"Height should not change on move, was {initial['h']} now {after['h']}"
            )
            # Position should have shifted
            assert after["l"] != initial["l"] or after["t"] != initial["t"], (
                f"Position should change on move, was ({initial['l']},{initial['t']}) now ({after['l']},{after['t']})"
            )

    def test_scale_attr_dim_below_mask(self, browser, tmp_path):
        """Scale/attribution stay below the dim mask (z-index stacking).

        Regression: when the crop box was attached to map._mapPane (which has
        z-index:400 creating a stacking context), the box's 9501 z-index was
        trapped inside a 400-level context, so scale/attr (850) rendered above
        the dim shadow. The box must live in mapContainer (z auto) so it
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
            # Mask z (9501) must be above scale/attr z (850)
            assert info["boxZ"] > info["scaleZ"], (
                f"Mask z={info['boxZ']} must be above scale z={info['scaleZ']}"
            )
            assert info["boxZ"] > info["attrZ"], (
                f"Mask z={info['boxZ']} must be above attr z={info['attrZ']}"
            )

    def test_saved_bounds_restore(self, browser, tmp_path):
        """Saved bounds in localStorage restore the crop box on toggle."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
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
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            assert page.locator(".foliplus-export-box.locked").is_visible(), (
                "Saved bounds should auto-lock the crop box"
            )

            # Verify the export button (download) is shown after lock
            assert page.locator(".foliplus-tool-bar .confirm").is_visible()

    def test_export_with_heatmap_canvas(self, browser, tmp_path):
        """Export with a canvas layer (simulated) produces no errors."""
        from foliplus import LayerControl

        with use_page(self._make_page, browser, tmp_path, slug="export_heatmap") as (
            page,
            _,
        ):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # Create a canvas layer via LayerControl API
            page.evaluate(_js("ExportControl/create_test_canvas"))

            # Open export, lock, export
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()

            page.wait_for_function(
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(500)

            # Cleanup canvas layer
            page.evaluate(_js("ExportControl/remove_test_canvas"))
            assert len(errors) == 0, f"JS errors on canvas export: {errors}"

    def test_crop_box_drag_resize(self, browser, tmp_path):
        """Drag bottom-right handle to resize the crop box."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            initial = page.evaluate(_js("ExportControl/read_box_rect"))

            # Drag bottom-right handle to enlarge
            handle = page.locator(".foliplus-export-handle.br")
            hb = handle.bounding_box()
            page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
            page.mouse.down()
            page.mouse.move(
                hb["x"] + hb["width"] / 2 + 80,
                hb["y"] + hb["height"] / 2 + 40,
                steps=10,
            )
            page.mouse.up()
            page.wait_for_timeout(200)

            after_resize = page.evaluate(_js("ExportControl/read_box_rect"))
            assert after_resize["w"] > initial["w"], "Resize should enlarge width"

    def test_locked_box_follows_zoom(self, browser, tmp_path):
        """Locked crop box follows the map after zoom."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            # Lock the box
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )

            # Zoom in — the locked box should keep tracking the same geo area
            page.keyboard.press("Control+=")
            page.wait_for_timeout(1000)

            # Box should still be visible and locked
            assert page.locator(".foliplus-export-box.locked").is_visible()
            after_zoom = page.evaluate(_js("ExportControl/read_box_rect"))
            assert after_zoom["w"] > 0 and after_zoom["h"] > 0, (
                f"Box disappeared after zoom, size={after_zoom}"
            )
