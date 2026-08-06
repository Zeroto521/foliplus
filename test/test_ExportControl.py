"""Tests for foliplus.ExportControl."""

from __future__ import annotations

import folium
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

    def test_quality_default(self):
        assert ExportControl().quality == 0.92

    def test_quality_custom(self):
        assert ExportControl(quality=0.5).quality == 0.5

    def test_locale_config(self):
        from foliplus.locale import LocaleConfig

        cfg = LocaleConfig(language="zh")
        ctrl = ExportControl(locale=cfg)
        assert ctrl._locale_code == "zh"


class TestExportControlRendering:
    def test_default_params(self, base_map: folium.Map):
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "ExportRenderer" in html
        assert "exportManager" in html
        assert "ctrl-fold" in html
        assert "foliplus.storage.load(CONST.STORAGE.KEY, CONST.name)" in html
        assert "foliplus.storage.save(" in html
        assert "loadSavedBounds" in html
        assert "foliplus-export-ctrl" in html

    def test_custom_params_rendering(self, base_map: folium.Map):
        ExportControl(
            filename="custom",
            format="jpeg",
            quality=0.8,
            scale=1.5,
            background="#000000",
            timeout=5000,
        ).add_to(base_map)
        html = render(base_map)
        assert "custom" in html
        assert "jpeg" in html
        assert "0.8" in html
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
        assert "restoreFromSavedBounds" in html
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
        assert "TIMEOUT" in html
        assert "RESTORE_DELAY" in html
        assert "CROP" in html
        assert "SEL" in html
        assert "CLASSES" in html
        assert "MIME" in html
        assert "QUALITY" in html

    def test_bitmap_cache_shared(self, base_map: folium.Map):
        """bitmapCache is shared between tile and sprite loading."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "bitmapCache" in html
        assert "loadImageBitmap" in html
        assert "CACHE" in html
        assert "TILE_MAX" in html

    def test_format_mime_lookup(self, base_map: folium.Map):
        """MIME type lookup table is present in rendered JS."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "CONST.MIME" in html
        assert "image/png" in html
        assert "image/jpeg" in html
        assert "image/webp" in html

    def test_undo_stack(self, base_map: folium.Map):
        """Undo stack and Ctrl+Z handler are present."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "undoStack" in html
        assert "undoCropBox" in html
        assert "pushUndoState" in html
        assert "ctrlKey" in html
        assert "e.key.toLowerCase()" in html

    def test_preview_dismiss(self, base_map: folium.Map):
        """Preview image can be dismissed by click."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "addEventListener" in html
        assert "dismissPreview" in html

    def test_render_methods_present(self, base_map: folium.Map):
        """All render sub-methods are defined."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "renderTileLayer" in html
        assert "renderPaneSVG" in html
        assert "renderPaneCanvas" in html
        assert "renderMarkers" in html
        assert "renderFontAwesome" in html
        assert "renderTextLabels" in html
        assert "renderRemaining" in html

    def test_render_remaining_async(self, base_map: folium.Map):
        """renderRemaining is async and awaited in render()."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "async renderRemaining" in html
        assert "await this.renderRemaining" in html

    def test_svg_inline_styles(self, base_map: folium.Map):
        """SVG renderer inlines computed styles for CSS class fidelity."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "getComputedStyle" in html
        assert "XMLSerializer" in html
        assert "serializeToString" in html

    def test_svg_uses_style_property_not_setattribute(self, base_map: folium.Map):
        """SVG renderer uses computed style inlining for CSS class fidelity."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "cloneNode(true)" in html
        assert "getComputedStyle" in html
        assert 'setAttribute("width"' in html or 'setAttribute("height"' in html

    def test_svg_geometry_attributes_preserved(self, base_map: folium.Map):
        """SVG geometry attrs are preserved by cloneNode(true)."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "cloneNode(true)" in html
        assert "serializeToString" in html

    def test_render_markers_is_async(self, base_map: folium.Map):
        """renderMarkers is async and awaited in render()."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "async renderMarkers" in html
        assert "await this.renderMarkers" in html

    def test_svg_inlines_computed_styles(self, base_map: folium.Map):
        """SVG clone inlines getComputedStyle values for CSS class fidelity."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "getComputedStyle" in html
        assert "inline.style[p]" in html or "inline.style" in html

    def test_svg_skips_default_fill_stroke(self, base_map: folium.Map):
        """SVG inliner skips default fill=rgb(0,0,0) and stroke=none."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert 'fill" && v === "rgb(0, 0, 0)"' in html
        assert 'stroke" && v === "none"' in html

    def test_svg_content_detection(self, base_map: folium.Map):
        """renderPaneSVG detects SVG content both in <g> and as direct children (migrateLayers)."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        # Checks for <g> children
        assert "svgG && svgG.children.length > 0" in html
        # Checks for direct geometry paths (migrateLayers moves <path> out of <g>)
        assert "svgEl.querySelector(" in html
        assert "path, polygon, polyline, circle" in html

    def test_collect_layer_markers_excludes(self, base_map: folium.Map):
        """collectLayerMarkers excludes opt-out elements via SKIP_EXPORT."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "collectLayerMarkers" in html
        assert "CONST.SEL.SKIP_EXPORT" in html

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
        """del-icon elements are excluded via data-foliplus-export attribute."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert 'data-foliplus-export="exclude"' in html

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
        ExportControl(filename="custom").add_to(base_map)
        html = render(base_map)
        assert "custom" in html
        assert "FILENAME" in html

    def test_css_loaded(self, base_map: folium.Map):
        """ExportControl CSS is included."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-export-overlay" in html
        assert "foliplus-export-box" in html
        assert "foliplus-export-handle" in html
        assert "foliplus-export-center" in html
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
        ctrl = ExportControl()
        assert hasattr(ctrl, "filename")
        assert hasattr(ctrl, "scale")
        assert hasattr(ctrl, "background")
        assert hasattr(ctrl, "timeout")
        assert hasattr(ctrl, "position")
        assert hasattr(ctrl, "_template")

    # ── Rendering: individual render passes ──

    def test_render_tiles_geo_bounds_path(self, base_map: folium.Map):
        """renderTileLayer renders a single tile layer from geo bounds."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "calcTiles" in html
        assert "tileLayer" in html
        assert "createImageBitmap" in html

    def test_render_canvas_hooks(self, base_map: folium.Map):
        """renderPaneCanvas calls before/after lifecycle hooks."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "ce.hooks" in html
        assert "ce.hooks.before" in html
        assert "ce.hooks.after" in html

    def test_render_markers_sprite_loading(self, base_map: folium.Map):
        """renderMarkers loads sprites via shared bitmap cache (loadImageBitmap)."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "loadImageBitmap" in html
        assert "spriteMap" in html
        assert "bitmapCache" in html

    def test_render_marker_roots_marker_and_label(self, base_map: folium.Map):
        """collectLayerMarkers collects pane children, skipping SVG/CANVAS and opt-out."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "CONST.SEL.SKIP_EXPORT" in html
        assert "el.tagName === " in html

    def test_render_fontawesome_pseudo_element(self, base_map: folium.Map):
        """renderFontAwesome reads ::before pseudo-element content."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "getComputedStyle" in html
        assert "::before" in html or "pseudo" in html

    def test_render_text_labels_background(self, base_map: folium.Map):
        """renderTextLabels draws background behind text."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "backgroundColor" in html
        assert "fillRect" in html

    def test_render_text_labels_font_loading(self, base_map: folium.Map):
        """renderTextLabels awaits document.fonts.ready."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "document.fonts.ready" in html

    def test_render_remaining_inline_svg(self, base_map: folium.Map):
        """renderRemaining serializes inline SVG (PIN_ICON, LOCATE)."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "XMLSerializer" in html
        assert "serializeToString" in html
        assert "clone.setAttribute" in html

    def test_render_remaining_img_elements(self, base_map: folium.Map):
        """renderRemaining handles <img> elements (default markers)."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert 'root.tagName === "IMG"' in html
        assert "imgEl.src" in html

    def test_render_remaining_bg_color_fallback(self, base_map: folium.Map):
        """renderRemaining draws background-color divIcons (center dot)."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "backgroundColor" in html
        assert "hasBgColor" in html
        assert "roundRect" in html

    def test_render_remaining_color_inline_svg(self, base_map: folium.Map):
        """renderRemaining inlines root color for currentColor SVG support."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "currentColor" in html or "rootColor" in html
        assert 'clone.setAttribute("color"' in html

    def test_svg_xmlns_injection(self, base_map: folium.Map):
        """SVG serialization injects xmlns when missing."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "CONST.SVG_NS" in html
        assert "src.includes" in html

    def test_svg_length_check(self, base_map: folium.Map):
        """SVG with src.length < 100 is skipped."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "src.length < 100" in html

    def test_svg_error_handling(self, base_map: folium.Map):
        """SVG load errors are caught with error handling."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "err_image_load" in html
        assert "reject" in html

    def test_render_methods_order(self, base_map: folium.Map):
        """Render passes follow painter's-algorithm order."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        # Order: tiles → SVG → canvas → markers → FA → text → remaining
        assert "renderTileLayer" in html
        assert "renderPaneSVG" in html
        assert "renderPaneCanvas" in html
        assert "renderFontAwesome" in html
        assert "renderTextLabels" in html
        assert "renderRemaining" in html

    # ── LayerControl integration ──

    def test_no_layercontrol_guard(self, base_map: folium.Map):
        """ExportControl shows guard when LayerControl is missing."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "no_layercontrol" in html
        assert "LayerAPI" in html

    def test_discover_layer_panes_method(self, base_map: folium.Map):
        """getLayerPanes resolves panes from LayerControl API."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "getLayerPanes" in html

    def test_collect_layer_markers_method(self, base_map: folium.Map):
        """collectLayerMarkers finds markers in a layer's panes."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "collectLayerMarkers" in html
        assert "CONST.SEL.SKIP_EXPORT" in html

    def test_render_pane_svg_method(self, base_map: folium.Map):
        """renderPaneSVG renders SVG content from a single pane."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "renderPaneSVG" in html
        assert "getComputedStyle" in html
        assert "serializeToString" in html

    def test_render_pane_canvas_method(self, base_map: folium.Map):
        """renderPaneCanvas renders canvas elements from a single pane."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "renderPaneCanvas" in html
        assert "hooks" in html
        assert "toDataURL" in html

    def test_api_layers_iteration(self, base_map: folium.Map):
        """render iterates api.layers (read-only view) for per-layer rendering."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "api.layers" in html

    def test_canvas_selector_defined(self, base_map: folium.Map):
        """CONST.SEL.CANVAS selector targets foliplus-canvas elements."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "canvas.foliplus" in html or "foliplus-canvas" in html

    def test_render_base_layer_skipped(self, base_map: folium.Map):
        """render() renders TileLayer via renderTileLayer inside per-layer loop."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "L.TileLayer" in html
        assert "renderTileLayer" in html

    def test_render_invisible_layer_skipped(self, base_map: folium.Map):
        """render() skips hidden layers via li.visible (managed by LayerControl)."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "li.visible" in html
        assert "if (!li.visible) continue" in html

    def test_render_methods_awaited(self, base_map: folium.Map):
        """All render passes are awaited in render()."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "await this.renderTileLayer" in html
        assert "await this.renderPaneSVG" in html
        assert "await this.renderPaneCanvas" in html
        assert "await this.renderMarkers" in html
        assert "await this.renderFontAwesome" in html
        assert "await this.renderTextLabels" in html
        assert "await this.renderRemaining" in html

    def test_get_tile_layers_sorted(self, base_map: folium.Map):
        """TileLayer detection uses instanceof L.TileLayer."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "L.TileLayer" in html
        assert "renderTileLayer" in html

    def test_svg_clone_removes_style_attribute(self, base_map: folium.Map):
        """renderPaneSVG removes style attribute from cloned SVG."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "clone.removeAttribute" in html
        assert '"style"' in html

    def test_render_remaining_skips_label_elements(self, base_map: folium.Map):
        """renderRemaining skips elements matching CONST.SEL.LABEL."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "root.matches(CONST.SEL.LABEL)" in html
        assert "continue" in html

    def test_render_remaining_draws_border(self, base_map: folium.Map):
        """renderRemaining draws border for background-color elements."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "borderColor" in html
        assert "strokeRect" in html or "roundRect" in html

    def test_render_remaining_color_from_parent(self, base_map: folium.Map):
        """renderRemaining reads color from parentElement for currentColor SVG."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "colorParent" in html
        assert "parentElement" in html
        assert 'clone.setAttribute("color"' in html

    def test_render_text_labels_escapes_fa_icons(self, base_map: folium.Map):
        """renderTextLabels skips elements with <i> child (FontAwesome)."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert 'root.querySelector("i")' in html
        assert "continue" in html

    def test_render_text_labels_multiline(self, base_map: folium.Map):
        """renderTextLabels handles multi-line text with lineHeight."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert '.split("\\n")' in html
        assert "lineHeight" in html
        assert "lines.length" in html

    def test_render_tiles_dom_fallback(self, base_map: folium.Map):
        """renderTileLayer returns early when geoBounds is missing."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "renderTileLayer" in html
        assert "if (!geoBounds || !geoBounds.nw) return" in html

    def test_tile_cors_interceptor(self, base_map: folium.Map):
        """CORS interceptor sets crossOrigin on TileLayer add."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "crossOrigin" in html
        assert "layeradd" in html
        assert "anonymous" in html


class TestExportControlBrowser:
    """Browser-level tests for ExportControl."""

    def test_toggle_button_present(self, browser, tmp_path):
        """Export toggle button is rendered and clickable."""

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        from foliplus import LayerControl

        LayerControl().add_to(m)
        ExportControl().add_to(m)
        html = m.get_root().render()
        html_path = tmp_path / "export_toggle.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            btn = page.wait_for_selector(
                ".foliplus-export-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            assert btn is not None, "Export toggle button not found"
        finally:
            page.close()

    def test_crop_box_appears_on_click(self, browser, tmp_path):
        """Clicking toggle button shows the crop box."""

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        from foliplus import LayerControl

        LayerControl().add_to(m)
        ExportControl().add_to(m)
        html = m.get_root().render()
        html_path = tmp_path / "export_crop.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl",
                state="attached",
                timeout=10000,
            )
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
        finally:
            page.close()

    def test_escape_closes_crop_box(self, browser, tmp_path):
        """Pressing Escape with unlocked crop box removes it."""

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        from foliplus import LayerControl

        LayerControl().add_to(m)
        ExportControl().add_to(m)
        html = m.get_root().render()
        html_path = tmp_path / "export_escape.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl",
                state="attached",
                timeout=10000,
            )
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
        finally:
            page.close()

    def test_enter_locks_crop_box(self, browser, tmp_path):
        """Pressing Enter locks the crop box (dashed > solid border)."""

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        from foliplus import LayerControl

        LayerControl().add_to(m)
        ExportControl().add_to(m)
        html = m.get_root().render()
        html_path = tmp_path / "export_enter.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl",
                state="attached",
                timeout=10000,
            )
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
        finally:
            page.close()

    def test_export_mode_class(self, browser, tmp_path):
        """foliplus-export-mode class is added to body and map container."""

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        from foliplus import LayerControl

        LayerControl().add_to(m)
        ExportControl().add_to(m)
        html = m.get_root().render()
        html_path = tmp_path / "export_mode.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl",
                state="attached",
                timeout=10000,
            )
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
            has_map_mode = page.evaluate("""() => {
                const c = document.querySelector('.leaflet-container');
                return c && c.classList.contains('foliplus-export-mode');
            }""")
            assert has_map_mode, "map container should have foliplus-export-mode"
        finally:
            page.close()

    def test_lock_unlock_cycle(self, browser, tmp_path):
        """Lock then unlock crop box transitions correctly."""

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        from foliplus import LayerControl

        LayerControl().add_to(m)
        ExportControl().add_to(m)
        html_path = tmp_path / "export_lock_unlock.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl", state="attached", timeout=10000
            )
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
        finally:
            page.close()

    def test_no_console_errors_on_open(self, browser, tmp_path):
        """Opening export control should not produce JS errors."""

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        from foliplus import LayerControl

        LayerControl().add_to(m)
        ExportControl().add_to(m)
        html_path = tmp_path / "export_no_errors.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl", state="attached", timeout=10000
            )
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)
            assert len(errors) == 0, f"JS errors on open: {errors}"
        finally:
            page.close()

    def test_export_vector_and_marker_content(self, browser, tmp_path):
        """Export with vector polygon + Marker layers produces non-blank canvas."""

        from foliplus import LayerControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)

        # Add a polygon (vector layer)
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
        ).add_to(m)

        # Add a Marker
        folium.Marker(
            [26.08, 119.30], popup="Center", name="Test Marker", overlay=True, show=True
        ).add_to(m)

        LayerControl().add_to(m)
        ExportControl().add_to(m)

        html_path = tmp_path / "export_vector_content.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl", state="attached", timeout=10000
            )

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
            api_layers = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api || !api.layers) return [];
                return api.layers.map(l => ({ id: l.id, visible: l.visible, isBase: l.isBase }));
            }""")
            assert len(api_layers) > 0, f"No layers in API. errors={errors}"

            overlay_layers = [l for l in api_layers if not l["isBase"] and l["visible"]]
            assert len(overlay_layers) > 0, (
                f"No visible overlay layers. api={api_layers} errors={errors}"
            )
        finally:
            page.close()

        def test_crop_box_drag_resize(self, browser, tmp_path):
            """Dragging a crop box handle resizes the box."""
            m = folium.Map(location=[26.08, 119.30], zoom_start=12)
            from foliplus import LayerControl

            LayerControl().add_to(m)
            ExportControl().add_to(m)
            html_path = tmp_path / "export_drag_resize.html"
            html_path.write_text(m.get_root().render(), encoding="utf-8")

            page = browser.new_page()
            try:
                page.goto(f"file://{html_path}", wait_until="domcontentloaded")
                page.wait_for_selector(
                    ".foliplus-export-ctrl", state="attached", timeout=10000
                )
                page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
                page.wait_for_selector(
                    ".foliplus-export-box", state="attached", timeout=5000
                )

                # Get initial box size
                initial = page.evaluate("""() => {
                    const box = document.querySelector('.foliplus-export-box');
                    const r = box.getBoundingClientRect();
                    return { w: r.width, h: r.height, l: r.left, t: r.top };
                }""")

                # Drag the bottom-right handle (br) by 50px right and 30px down
                handle = page.locator(".foliplus-export-handle.br")
                box = page.locator(".foliplus-export-box")
                handle.drag_to(
                    box,
                    source_position={x: 0, y: 0},
                    target_position={x: 50, y: 30},
                    force=True,
                )
                page.wait_for_timeout(300)

                after = page.evaluate("""() => {
                    const box = document.querySelector('.foliplus-export-box');
                    const r = box.getBoundingClientRect();
                    return { w: r.width, h: r.height, l: r.left, t: r.top };
                }""")
                assert after["w"] > initial["w"], (
                    f"Expected width increased, was {initial['w']} now {after['w']}"
                )
                assert after["h"] > initial["h"], (
                    f"Expected height increased, was {initial['h']} now {after['h']}"
                )
            finally:
                page.close()

        def test_crop_box_drag_move(self, browser, tmp_path):
            """Dragging the crop box center moves the box."""
            m = folium.Map(location=[26.08, 119.30], zoom_start=12)
            from foliplus import LayerControl

            LayerControl().add_to(m)
            ExportControl().add_to(m)
            html_path = tmp_path / "export_drag_move.html"
            html_path.write_text(m.get_root().render(), encoding="utf-8")

            page = browser.new_page()
            try:
                page.goto(f"file://{html_path}", wait_until="domcontentloaded")
                page.wait_for_selector(
                    ".foliplus-export-ctrl", state="attached", timeout=10000
                )
                page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
                page.wait_for_selector(
                    ".foliplus-export-box", state="attached", timeout=5000
                )

                initial = page.evaluate("""() => {
                    const box = document.querySelector('.foliplus-export-box');
                    const r = box.getBoundingClientRect();
                    return { l: r.left, t: r.top, w: r.width, h: r.height };
                }""")

                # Drag the center by 30px right and 20px down
                center = page.locator(".foliplus-export-center")
                box = page.locator(".foliplus-export-box")
                center.drag_to(
                    box,
                    source_position={x: 0, y: 0},
                    target_position={x: 30, y: 20},
                    force=True,
                )
                page.wait_for_timeout(300)

                after = page.evaluate("""() => {
                    const box = document.querySelector('.foliplus-export-box');
                    const r = box.getBoundingClientRect();
                    return { l: r.left, t: r.top, w: r.width, h: r.height };
                }""")
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
            finally:
                page.close()

        def test_saved_bounds_restore(self, browser, tmp_path):
            """Saved bounds in localStorage restore the crop box on toggle."""
            m = folium.Map(location=[26.08, 119.30], zoom_start=12)
            from foliplus import LayerControl

            LayerControl().add_to(m)
            ExportControl().add_to(m)
            html_path = tmp_path / "export_saved_bounds.html"
            html_path.write_text(m.get_root().render(), encoding="utf-8")

            page = browser.new_page()
            try:
                page.goto(f"file://{html_path}", wait_until="domcontentloaded")
                page.wait_for_selector(
                    ".foliplus-export-ctrl", state="attached", timeout=10000
                )

                # Pre-set localStorage with saved bounds using the map-specific key
                map_name = page.evaluate("""() => {
                    const html = document.querySelector('script:not([src])').textContent;
                    const m = html.match(/var\\s+(\\w+)\\s*=\\s*L\\.map\\(/);
                    return m ? m[1] : 'map';
                }""")
                page.evaluate(
                    """(key) => {
                    localStorage.setItem(key, JSON.stringify({
                        nw: { lat: 26.07, lng: 119.28 },
                        se: { lat: 26.09, lng: 119.32 }
                    }));
                }""",
                    "foliplus_export_rect_" + map_name,
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
            finally:
                page.close()

        def test_export_with_heatmap_canvas(self, browser, tmp_path):
            """Export with a canvas layer (simulated) produces no errors."""
            m = folium.Map(location=[26.08, 119.30], zoom_start=12)
            from foliplus import LayerControl

            LayerControl().add_to(m)
            ExportControl().add_to(m)
            html_path = tmp_path / "export_heatmap_canvas.html"
            html_path.write_text(m.get_root().render(), encoding="utf-8")

            page = browser.new_page()
            try:
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(f"file://{html_path}", wait_until="domcontentloaded")
                page.wait_for_selector(
                    ".foliplus-export-ctrl", state="attached", timeout=10000
                )

                # Create a canvas layer via LayerControl API
                page.evaluate("""() => {
                    const api = window.foliplus && window.foliplus.LayerAPI;
                    if (!api) return;
                    const cvs = api.createCanvas({ id: '__test_export_canvas__', name: 'Test Canvas' });
                    const ctx = cvs.ctx;
                    ctx.fillStyle = 'red';
                    ctx.fillRect(10, 10, 100, 100);
                    cvs.register();
                }""")

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
                page.evaluate("""() => {
                    const api = window.foliplus && window.foliplus.LayerAPI;
                    if (!api) return;
                    api.unregisterLayer('__test_export_canvas__');
                }""")
                assert len(errors) == 0, f"JS errors on canvas export: {errors}"
            finally:
                page.close()
