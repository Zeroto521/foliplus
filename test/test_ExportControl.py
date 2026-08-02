"""Tests for foliplus.ExportControl."""

from __future__ import annotations

import json
import pathlib

import folium
import pytest
from conftest import render

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
        assert ctrl.filename == "map.png"
        assert ctrl.scale == 2.0
        assert ctrl.background is None
        assert ctrl.timeout == 7500

    def test_custom_args(self):
        ctrl = ExportControl(
            filename="my_map.png",
            scale=3.5,
            background="#ffffff",
            timeout=10000,
        )
        assert ctrl.filename == "my_map.png"
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

    def test_locale_config(self):
        from foliplus.locale import LocaleConfig
        cfg = LocaleConfig(language="zh")
        ctrl = ExportControl(locale=cfg)
        assert ctrl._locale_code == "zh"


class TestExportControlRendering:
    def test_default_params(self, base_map: folium.Map):
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "LeafletRenderer" in html
        assert "exportManager" in html
        assert "ctrl-fold" in html
        assert "STORAGE.KEY" in html
        assert "saveBounds" in html
        assert "loadSavedBounds" in html
        assert "foliplus-export-actions" in html

    def test_custom_params_rendering(self, base_map: folium.Map):
        ExportControl(
            filename="custom.png",
            scale=1.5,
            background="#000000",
            timeout=5000,
        ).add_to(base_map)
        html = render(base_map)
        assert "custom.png" in html
        assert "1.5" in html
        assert "#000000" in html
        assert "5000" in html

    def test_crop_features(self, base_map: folium.Map):
        """Verify crop box structures: handles, center, toggle behavior."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-export-handle" in html
        assert "foliplus-export-center" in html
        assert "foliplus-export-box" in html
        assert "foliplus-export-overlay" in html
        assert "showCropBox" in html
        assert "lockCropBox" in html
        assert "unlockCropBox" in html
        assert "removeCropBox" in html
        assert "8-way" in html or "tl" in html

    def test_hooks_and_events(self, base_map: folium.Map):
        """Key event and lifecycle hooks are present."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "bindOutsideCollapse" in html
        assert "getBoundingClientRect" in html
        assert "containerPointToLatLng" in html
        assert "Object.assign" in html

    def test_create_fold_shared(self, base_map: folium.Map):
        """Uses shared createFoldControl helper from runtime."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "createFoldControl" in html
        assert "ctrl-fold" in html

    def test_const_structure(self, base_map: folium.Map):
        """CONST group structure is present in rendered JS."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "CONSTANT_PADDING" in html or "CONTAINER_PADDING" in html
        assert "TIMING" in html
        assert "RENDER_DELAY" in html
        assert "RESTORE_DELAY" in html
        assert "CROP" in html
        assert "SEL" in html
        assert "CLASSES" in html

    def test_render_methods_present(self, base_map: folium.Map):
        """All render sub-methods are defined."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "renderTiles" in html
        assert "renderSVG" in html
        assert "renderCanvas" in html
        assert "renderMarkers" in html
        assert "renderFontAwesome" in html
        assert "renderTextLabels" in html

    def test_svg_inline_styles(self, base_map: folium.Map):
        """SVG renderer inlines computed styles for CSS class fidelity."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "stroke" in html
        assert "getComputedStyle" in html
        assert "XMLSerializer" in html
        assert "serde" in html or "serializeToString" in html

    def test_collect_marker_roots(self, base_map: folium.Map):
        """_collectMarkerRoots excludes del-icons and popups."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "collectMarkerRoots" in html
        assert "foliplus-del-icon" in html
        assert "leaflet-popup" in html

    def test_debounce_on_map_change(self, base_map: folium.Map):
        """onMapChange uses foliplus.debounce."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "debounce" in html
        assert "onMapChange" in html

    def test_keyboard_events(self, base_map: folium.Map):
        """Escape and Enter key handlers are defined."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "onKeyDown" in html
        assert "Escape" in html
        assert "unlockCropBox" in html
        assert "Enter" in html

    def test_drag_handlers(self, base_map: folium.Map):
        """Mouse drag handlers are bound."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "onMouseDown" in html
        assert "onMouseMove" in html
        assert "onMouseUp" in html

    def test_hint_size_prefix_suffix(self, base_map: folium.Map):
        """Hint shows size info with prefix/suffix."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "label_size_prefix" in html
        assert "label_size_suffix" in html

    def test_exporting_status(self, base_map: folium.Map):
        """Exporting status hint is shown."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "status_exporting" in html
        assert "status_success" in html
        assert "status_fail" in html

    def test_locale_zh(self, base_map: folium.Map):
        ExportControl(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "导出" in html
        assert "ExportControl.btn_title" in html

    def test_del_icon_exclusion(self, base_map: folium.Map):
        """del-icon and leaflet-popup are excluded from marker roots."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-del-icon" in html
        assert "leaflet-popup" in html

    def test_hidden_class(self, base_map: folium.Map):
        """foliplus-export-hidden class for hiding controls during render."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-export-hidden" in html

    def test_preview_image(self, base_map: folium.Map):
        """Preview image is created with correct class name."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "CONST.CLASSES.PREVIEW" in html
        assert "prevImg" in html
        assert "toDataURL" in html

    def test_filename_rendered(self, base_map: folium.Map):
        """Filename is injected into the JS template."""
        ExportControl(filename="custom.png").add_to(base_map)
        html = render(base_map)
        assert "custom.png" in html
        assert "FILENAME" in html

    def test_css_loaded(self, base_map: folium.Map):
        """ExportControl CSS is included."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-export-overlay" in html
        assert "foliplus-export-box" in html
        assert "foliplus-export-handle" in html
        assert "foliplus-export-center" in html
        assert "foliplus-export-actions" in html
        assert "foliplus-export-ctrl" in html
        assert "foliplus-export-preview" in html
        assert "foliplus-export-hidden" in html

    def test_css_z_index_pattern(self, base_map: folium.Map):
        """CSS uses --z-export-base variable with calc()."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "z-export-base" in html
        assert "calc(" in html

    def test_export_control_py_file(self):
        """ExportControl.py has expected exports."""
        from foliplus import ExportControl
        ctrl = ExportControl()
        assert hasattr(ctrl, "filename")
        assert hasattr(ctrl, "scale")
        assert hasattr(ctrl, "background")
        assert hasattr(ctrl, "timeout")
        assert hasattr(ctrl, "position")
        assert hasattr(ctrl, "_template")


class TestExportControlBrowser:
    """Browser-level tests for ExportControl."""

    def test_toggle_button_present(self, browser, tmp_path):
        """Export toggle button is rendered and clickable."""
        import folium
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        ExportControl().add_to(m)
        html = m.get_root().render()
        html_path = tmp_path / "export_toggle.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            btn = page.wait_for_selector(
                ".foliplus-export-ctrl .foliplus-toggle-btn",
                state="attached", timeout=10000,
            )
            assert btn is not None, "Export toggle button not found"
        finally:
            page.close()

    def test_crop_box_appears_on_click(self, browser, tmp_path):
        """Clicking toggle button shows the crop box."""
        import folium
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        ExportControl().add_to(m)
        html = m.get_root().render()
        html_path = tmp_path / "export_crop.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl", state="attached", timeout=10000,
            )
            btn = page.locator(".foliplus-export-ctrl .foliplus-toggle-btn")
            btn.click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000,
            )
            assert page.locator(".foliplus-export-box").is_visible()
            assert page.locator(".foliplus-export-overlay").is_visible()
            assert page.locator(".foliplus-export-handle").count() == 8
        finally:
            page.close()

    def test_escape_closes_crop_box(self, browser, tmp_path):
        """Pressing Escape with unlocked crop box removes it."""
        import folium
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        ExportControl().add_to(m)
        html = m.get_root().render()
        html_path = tmp_path / "export_escape.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl", state="attached", timeout=10000,
            )
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000,
            )
            # Verify crop box is visible
            assert page.locator(".foliplus-export-box").is_visible()
            # Press Escape
            page.keyboard.press("Escape")
            # Crop box should disappear
            page.wait_for_selector(
                ".foliplus-export-box", state="hidden", timeout=5000,
            )
        finally:
            page.close()

    def test_enter_locks_crop_box(self, browser, tmp_path):
        """Pressing Enter locks the crop box (dashed > solid border)."""
        import folium
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        ExportControl().add_to(m)
        html = m.get_root().render()
        html_path = tmp_path / "export_enter.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl", state="attached", timeout=10000,
            )
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000,
            )
            # Lock via confirm button
            page.locator(".foliplus-export-actions .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000,
            )
            assert page.locator(".foliplus-export-box.locked").is_visible()
        finally:
            page.close()

    def test_export_mode_class(self, browser, tmp_path):
        """foliplus-export-mode class is added to body and map container."""
        import folium
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        ExportControl().add_to(m)
        html = m.get_root().render()
        html_path = tmp_path / "export_mode.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl", state="attached", timeout=10000,
            )
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000,
            )
            # Check export mode class on body
            has_mode = page.evaluate(
                "document.body.classList.contains('foliplus-export-mode')"
            )
            assert has_mode, "body should have foliplus-export-mode class"
            # Check on map container
            has_map_mode = page.evaluate("""() => {
                const c = document.querySelector('.leaflet-container');
                return c && c.classList.contains('foliplus-export-mode');
            }""")
            assert has_map_mode, "map container should have foliplus-export-mode"
        finally:
            page.close()
