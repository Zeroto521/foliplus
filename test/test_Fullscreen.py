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
        assert Fullscreen()._locale_code == ""

    def test_custom_locale(self):
        assert Fullscreen(locale="zh")._locale_code == "zh"


class TestFullscreenRendering:
    def test_default_params(self, base_map: folium.Map):
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "fullscreen" in html.lower()

    def test_hide_self_default(self, base_map: folium.Map):
        """hide_self=true injects the hide-zoom-container block."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert 'container.style.display = isFull ? "none" : ""' in html

    def test_hide_self_false(self, base_map: folium.Map):
        """hide_self=false wraps hide block in if (false)."""
        Fullscreen(hide_self=False).add_to(base_map)
        html = render(base_map)
        assert 'container.style.display = isFull ? "none" : ""' in html
        assert "if (false)" in html

    def test_contains_fullscreenchange_listener(self, base_map: folium.Map):
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "fullscreenchange" in html

    def test_locale_zh(self, base_map: folium.Map):
        Fullscreen(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "已进入全屏" in html
        assert "Fullscreen.enter" in html

    def test_css_fullscreen_variables(self, base_map: folium.Map):
        """Fullscreen CSS includes fullscreen container styles."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "foliplus-fullscreen-toggle" in html
        assert "ctrl-size" in html
        assert "foliplus-fullscreen-bar" in html

    def test_zoom_svg_inline(self, base_map: folium.Map):
        """Zoom +/- use inline SVGs created by Fullscreen.js."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "ZOOM_IN" in html
        assert "ZOOM_OUT" in html

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
        assert "SVGs.MINIMIZE" in html
        assert "SVGs.MAXIMIZE" in html

    def test_fullscreen_api_detection(self, base_map: folium.Map):
        """Fullscreen API detection is present."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "requestFullscreen" in html
        assert "fullscreenElement" in html

    def test_unload_cleanup(self, base_map: folium.Map):
        """Fullscreen removes listeners on map unload."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "fullscreenchange" in html
        assert 'map.on("unload"' in html

    def test_svg_icons_registered(self, base_map: folium.Map):
        """MAXIMIZE icon registered as hint icon for Fullscreen."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "registerHintIcon" in html
        assert "SVGs.MAXIMIZE" in html

    def test_custom_zoom_buttons_created(self, base_map: folium.Map):
        """Custom zoom +/- buttons are created by Fullscreen.js."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "foliplus-zoom-in" in html
        assert "foliplus-zoom-out" in html
        assert "foliplus-fullscreen-toggle" in html

    def test_buttons_are_button_elements(self, base_map: folium.Map):
        """Zoom +/- and fullscreen use <button> elements, not <a>."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        # JS creates buttons via window.foliplus.dom.el("button", ...)
        # (multi-line in rendered output, so check for the pattern)
        assert "dom.el(" in html and '"button"' in html
        # No old <a> tag patterns in button creation
        assert 'L.DomUtil.create("a"' not in html

    def test_leaflet_bar_container(self, base_map: folium.Map):
        """Container has leaflet-bar class for alignment."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert (
            r"class: `${CONST.CLASSES.LEAFLET_BAR} ${CONST.CLASSES.FULLSCREEN_BAR}`"
            in html
        )

    def test_default_zoom_removed(self, base_map: folium.Map):
        """Default Leaflet zoom control is removed."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "map.removeControl(map.zoomControl)" in html

    def test_zoom_translation_keys(self, base_map: folium.Map):
        """Zoom in/out use translation keys."""
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "Fullscreen.zoom_in" in html
        assert "Fullscreen.zoom_out" in html

    def test_hide_others_false_skips_others_block(self, base_map: folium.Map):
        """hide_others=false wraps sibling controls in if (false)."""
        Fullscreen(hide_others=False).add_to(base_map)
        html = render(base_map)
        assert "if (false)" in html

    def test_hide_self_independent_of_hide_others(self, base_map: folium.Map):
        """hide_self still works when hide_others=false."""
        Fullscreen(hide_self=True, hide_others=False).add_to(base_map)
        html = render(base_map)
        assert 'container.style.display = isFull ? "none" : ""' in html


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
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            has_btn = page.evaluate(
                "document.querySelector('.foliplus-fullscreen-toggle') !== null"
            )
            assert has_btn, "Fullscreen button not found"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_maximize_svg_default(self, browser, tmp_path):
        """Fullscreen button shows maximize SVG by default."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            svg = page.evaluate(
                "document.querySelector('.foliplus-fullscreen-toggle svg') !== null"
            )
            assert svg, "No SVG icon found"
            path_d = page.evaluate(
                "document.querySelector('.foliplus-fullscreen-toggle path').getAttribute('d')"
            )
            # Maximize icon has M8 3H5...
            assert "M8 3H5" in path_d
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_hide_self(self, browser, tmp_path):
        """hide_self=true hides fullscreen button when fullscreen."""
        page, errors = self._make_page(browser, tmp_path, hide_self=True)
        try:
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            has_self_hide = page.evaluate(
                "document.querySelector('.foliplus-fullscreen-toggle').innerHTML.indexOf('MINIMIZE') === -1"
            )
            assert has_self_hide
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()
