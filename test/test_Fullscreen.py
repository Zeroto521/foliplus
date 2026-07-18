"""Tests for foliplus.Fullscreen."""

from __future__ import annotations

import folium
from conftest import render

from foliplus import Fullscreen


class TestFullscreenPython:
    """Python-side property tests."""

    def test_name(self):
        assert Fullscreen()._name == "Fullscreen"

    def test_default_position(self):
        assert Fullscreen().position == "bottomright"

    def test_custom_position(self):
        assert Fullscreen(position="topleft").position == "topleft"

    def test_default_hide_self(self):
        assert Fullscreen().hide_self is True

    def test_custom_hide_self(self):
        assert Fullscreen(hide_self=False).hide_self is False

    def test_default_locale(self):
        assert Fullscreen()._LOCALE_CODE == ""

    def test_custom_locale(self):
        assert Fullscreen(locale="zh")._LOCALE_CODE == "zh"


class TestFullscreenRendering:
    def test_default_params(self, base_map: folium.Map):
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "fullscreen" in html.lower()

    def test_hide_self_default(self, base_map: folium.Map):
        Fullscreen().add_to(base_map)
        html = render(base_map)
        # hide_self=True renders as JS: if (true) { ...
        assert "if (true)" in html

    def test_hide_self_false(self, base_map: folium.Map):
        Fullscreen(hide_self=False).add_to(base_map)
        html = render(base_map)
        # hide_self=False renders as JS: if (false) { ...
        assert "if (false)" in html

    def test_contains_fullscreenchange_listener(self, base_map: folium.Map):
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "fullscreenchange" in html

    def test_custom_position_renders(self, base_map: folium.Map):
        Fullscreen(position="topleft").add_to(base_map)
        html = render(base_map)
        assert "fullscreen" in html.lower()

    def test_contains_fullscreen_cdn(self, base_map: folium.Map):
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "leaflet.fullscreen@3" in html
        assert "Control.FullScreen.min.js" in html
        assert "Control.FullScreen.css" in html

    def test_locale_zh(self, base_map: folium.Map):
        Fullscreen(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "已进入全屏" in html
        assert "Fullscreen.enter" in html

    def test_css_shadow_variable(self, base_map: folium.Map):
        """Fullscreen button uses --shadow-ctrl-strong for 悬浮感."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "shadow-ctrl-strong" in html
        assert "fullscreen-btn" in html

    def test_css_icon_size_variable(self, base_map: folium.Map):
        """Fullscreen button SVG uses --icon-size-md."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "icon-size-md" in html
        assert "ctrl-size" in html

    def test_css_unified_button_hover(self, base_map: folium.Map):
        """Fullscreen button shares unified hover via common.css group selector."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "leaflet-control-zoom-fullscreen:hover" in html

    def test_zoom_svg_replacement(self, base_map: folium.Map):
        """Zoom +/- have ::before pseudo-element with SVG icons."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "leaflet-control-zoom-in::before" in html
        assert "leaflet-control-zoom-out::before" in html

    def test_zoom_svg_hover_color(self, base_map: folium.Map):
        """Zoom +/- SVG icons change to accent color on hover."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "e74c3c" in html

    def test_css_unified_group_selectors(self, base_map: folium.Map):
        """Fullscreen button shares unified button styles with common.css."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "fullscreen-btn" in html

    def test_hide_others_functionality(self, base_map: folium.Map):
        """hide_others controls other control visibility in fullscreen."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        # hide_others=True renders as if (true) { ... } in JS template
        assert "// Toggle visibility of sibling controls" in html
        assert 'c.style.display = isFull ? "none" : ""' in html

    def test_maximize_minimize_svgs(self, base_map: folium.Map):
        """Fullscreen has MAXIMIZE and MINIMIZE SVG icons."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "MAXIMIZE" in html
        assert "MINIMIZE" in html

    def test_hint_on_fullscreen_change(self, base_map: folium.Map):
        """Fullscreen change shows enter/exit hint."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "window.foliplus.showHint" in html
        assert "HINT_DURATION.MEDIUM" in html

    def test_icon_swap_on_fullscreen(self, base_map: folium.Map):
        """Minimize icon shown when in fullscreen, maximize when not."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "container.innerHTML = isFull ? SVGs.MINIMIZE : SVGs.MAXIMIZE" in html

    def test_replace_icon_retry(self, base_map: folium.Map):
        """replaceIcon retries if button is not immediately available."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "setTimeout(replaceIcon, CONST.RETRY_INTERVAL_MS)" in html

    def test_retry_interval_constant(self, base_map: folium.Map):
        """RETRY_INTERVAL_MS is defined in constants."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "RETRY_INTERVAL_MS: 100" in html

    def test_unload_cleanup(self, base_map: folium.Map):
        """Fullscreen removes listeners on map unload."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert 'document.removeEventListener("fullscreenchange"' in html
        assert 'map.on("unload"' in html

    def test_force_separate_button_false(self, base_map: folium.Map):
        """forceSeparateButton is false to merge with zoom controls."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "forceSeparateButton: false" in html

    def test_button_clone_breaks_native_events(self, base_map: folium.Map):
        """cloneNode replaces the button to break native fullscreen event bindings."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "btn.cloneNode(true)" in html
        assert "btn.parentNode.replaceChild(newBtn, btn)" in html

    def test_svg_icons_registered(self, base_map: folium.Map):
        """MAXIMIZE icon registered as hint icon for Fullscreen."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "registerHintIcon" in html
        assert "SVGs.MAXIMIZE" in html


class TestFullscreenBrowser:
    """Browser-based smoke tests for Fullscreen."""

    def _make_page(self, browser, tmp_path, hide_self=True, hide_others=False):
        """Build a page with Fullscreen and return (page, errors)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        Fullscreen(hide_self=hide_self, hide_others=hide_others).add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "fullscreen_browser.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        errors = []
        page.on(
            "console",
            lambda msg: (
                errors.append(msg.text)
                if msg.type == "error"
                and not msg.text.startswith("Failed to load resource")
                else None
            ),
        )
        page.goto(f"file://{html_path}", wait_until="domcontentloaded")
        return page, errors

    def test_button_exists(self, browser, tmp_path):
        """Fullscreen button is present in the DOM."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.wait_for_selector(".fullscreen-btn", state="attached", timeout=10000)
            has_btn = page.evaluate(
                "document.querySelector('.fullscreen-btn') !== null"
            )
            assert has_btn, "Fullscreen button not found"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_maximize_svg_default(self, browser, tmp_path):
        """Fullscreen button shows maximize SVG by default."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.wait_for_selector(".fullscreen-btn", state="attached", timeout=10000)
            svg = page.evaluate("document.querySelector('.fullscreen-btn svg') !== null")
            assert svg, "No SVG icon found"
            path_d = page.evaluate("document.querySelector('.fullscreen-btn path').getAttribute('d')")
            # Maximize icon has M8 3H5...
            assert "M8 3H5" in path_d
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_hide_self(self, browser, tmp_path):
        """hide_self=true hides fullscreen button when fullscreen."""
        page, errors = self._make_page(browser, tmp_path, hide_self=True)
        try:
            page.wait_for_selector(".fullscreen-btn", state="attached", timeout=10000)
            has_self_hide = page.evaluate(
                "document.querySelector('.fullscreen-btn').innerHTML.indexOf('MINIMIZE') === -1"
            )
            assert has_self_hide
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()
