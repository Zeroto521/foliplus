"""Tests for foliplus.FullscreenControl."""

from __future__ import annotations

import folium
from conftest import render

from foliplus import FullscreenControl


class TestFullscreenControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert FullscreenControl()._name == "FullscreenControl"

    def test_default_position(self):
        assert FullscreenControl().position == "bottomright"

    def test_custom_position(self):
        assert FullscreenControl(position="topleft").position == "topleft"

    def test_default_hide_self(self):
        assert FullscreenControl().hide_self is True

    def test_custom_hide_self(self):
        assert FullscreenControl(hide_self=False).hide_self is False

    def test_default_locale(self):
        assert FullscreenControl()._locale_code == ""

    def test_custom_locale(self):
        assert FullscreenControl(locale="zh")._locale_code == "zh"


class TestFullscreeControlRendering:
    def test_default_params(self, base_map: folium.Map):
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "fullscreen" in html.lower()

    def test_hide_self_default(self, base_map: folium.Map):
        """hide_self=true injects the fullscreen-toggle hide block."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "classList.toggle(CONST.CLASSES.HIDDEN" in html

    def test_hide_self_false(self, base_map: folium.Map):
        """hide_self=false wraps hide block in if (false)."""
        FullscreenControl(hide_self=False).add_to(base_map)
        html = render(base_map)
        assert "classList.toggle(CONST.CLASSES.HIDDEN" in html
        assert "if (false)" in html

    def test_contains_fullscreenchange_listener(self, base_map: folium.Map):
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "fullscreenchange" in html

    def test_locale_zh(self, base_map: folium.Map):
        FullscreenControl(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "已进入全屏" in html
        assert "FullscreenControl.enter" in html

    def test_css_fullscreen_variables(self, base_map: folium.Map):
        """Fullscreen CSS includes fullscreen container styles."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-fullscreen-toggle" in html
        assert "ctrl-size" in html
        assert "foliplus-fullscreen-bar" in html

    def test_zoom_svg_inline(self, base_map: folium.Map):
        """Zoom +/- use inline SVGs created by FullscreenControl.js."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "ZOOM_IN" in html
        assert "ZOOM_OUT" in html

    def test_maximize_minimize_svgs(self, base_map: folium.Map):
        """Fullscreen has MAXIMIZE and MINIMIZE SVG icons, swapped on state change."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "MAXIMIZE" in html
        assert "MINIMIZE" in html
        assert "SVGs.MINIMIZE" in html
        assert "SVGs.MAXIMIZE" in html

    def test_hint_on_fullscreen_change(self, base_map: folium.Map):
        """Fullscreen change shows enter/exit hint."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.showHint" in html
        assert "HINT_DURATION.MEDIUM" in html

    def test_fullscreen_api_detection(self, base_map: folium.Map):
        """Fullscreen API detection is present."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "requestFullscreen" in html
        assert "fullscreenElement" in html

    def test_unload_cleanup(self, base_map: folium.Map):
        """Fullscreen removes listeners on map unload."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "fullscreenchange" in html
        assert 'map.on("unload"' in html

    def test_svg_icons_registered(self, base_map: folium.Map):
        """MAXIMIZE icon registered as hint icon for Fullscreen."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "registerHintIcon" in html
        assert "SVGs.MAXIMIZE" in html

    def test_custom_zoom_buttons_created(self, base_map: folium.Map):
        """Custom zoom +/- buttons are created by FullscreenControl.js."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-zoom-in" in html
        assert "foliplus-zoom-out" in html
        assert "foliplus-fullscreen-toggle" in html

    def test_buttons_are_button_elements(self, base_map: folium.Map):
        """Zoom +/- and fullscreen use <button> elements, not <a>."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        # JS creates buttons via foliplus.dom.el("button", ...)
        # (multi-line in rendered output, so check for the pattern)
        assert "dom.el(" in html and '"button"' in html
        # No old <a> tag patterns in button creation
        assert 'L.DomUtil.create("a"' not in html

    def test_leaflet_bar_container(self, base_map: folium.Map):
        """Container has two-layer structure: outer leaflet-bar, inner fullscreen-bar + ctrl-fold."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        # Outer: leaflet-bar leaflet-control
        assert 'class: "leaflet-bar leaflet-control"' in html
        # Inner: foliplus-fullscreen-bar foliplus-ctrl-fold (shared collapsed class)
        assert r"class: `${CONST.CLASSES.FULLSCREEN_BAR} foliplus-ctrl-fold`" in html

    def test_default_zoom_removed(self, base_map: folium.Map):
        """Default Leaflet zoom control is removed."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "map.removeControl(map.zoomControl)" in html

    def test_zoom_translation_keys(self, base_map: folium.Map):
        """Zoom in/out use translation keys."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "FullscreenControl.zoom_in" in html
        assert "FullscreenControl.zoom_out" in html

    def test_hide_others_false_skips_others_block(self, base_map: folium.Map):
        """hide_others=false wraps sibling controls in if (false)."""
        FullscreenControl(hide_others=False).add_to(base_map)
        html = render(base_map)
        assert "if (false)" in html

    def test_hide_self_independent_of_hide_others(self, base_map: folium.Map):
        """hide_self still works when hide_others=false."""
        FullscreenControl(hide_self=True, hide_others=False).add_to(base_map)
        html = render(base_map)
        assert "classList.toggle(CONST.CLASSES.HIDDEN" in html

    def test_zoom_buttons_hidden_with_hide_self(self, base_map: folium.Map):
        """hide_self hides zoom +/- together with the fullscreen button."""
        FullscreenControl(hide_self=True, hide_others=False).add_to(base_map)
        html = render(base_map)
        assert "ZOOM_IN" in html
        assert "ZOOM_OUT" in html
        assert "foliplus-fullscreen-hidden" in html

    def test_zoom_buttons_visible_without_hide_self(self, base_map: folium.Map):
        """hide_self=false keeps zoom +/- visible in fullscreen, like the
        fullscreen button itself."""
        FullscreenControl(hide_self=False, hide_others=False).add_to(base_map)
        html = render(base_map)
        assert "ZOOM_IN" in html
        assert "ZOOM_OUT" in html
        assert "if (false)" in html


class TestFullscreenControlBrowser:
    """Browser-based smoke tests for FullscreenControl."""

    def _make_page(self, browser, tmp_path, hide_self=True, hide_others=False):
        """Build a page with FullscreenControl and return (page, errors)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        FullscreenControl(hide_self=hide_self, hide_others=hide_others).add_to(m)

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
        """FullscreenControl button is present in the DOM."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            has_btn = page.evaluate(
                "document.querySelector('.foliplus-fullscreen-toggle') !== null"
            )
            assert has_btn, "FullscreenControl button not found"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_maximize_svg_default(self, browser, tmp_path):
        """FullscreenControl button shows maximize SVG by default."""
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

    def _enter_fullscreen(self, page):
        """Click the fullscreen toggle to enter fullscreen."""
        page.evaluate("document.querySelector('.foliplus-fullscreen-toggle').click()")
        page.wait_for_function("() => document.fullscreenElement !== null")

    def _exit_fullscreen(self, page):
        """Click the fullscreen toggle to exit fullscreen."""
        page.evaluate("document.querySelector('.foliplus-fullscreen-toggle').click()")
        page.wait_for_function("() => document.fullscreenElement === null")

    def _zoom_displays(self, page):
        """Return computed display of zoom in/out buttons."""
        return page.evaluate(
            """() => ({
                zoomIn: getComputedStyle(
                    document.querySelector('.foliplus-zoom-in')
                ).display,
                zoomOut: getComputedStyle(
                    document.querySelector('.foliplus-zoom-out')
                ).display,
            })"""
        )

    def test_zoom_hidden_in_fullscreen(self, browser, tmp_path):
        """hide_self=true: zoom +/- are hidden while in fullscreen."""
        page, errors = self._make_page(
            browser, tmp_path, hide_self=True, hide_others=False
        )
        try:
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            self._enter_fullscreen(page)
            displays = self._zoom_displays(page)
            assert displays["zoomIn"] == "none", displays
            assert displays["zoomOut"] == "none", displays
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_zoom_visible_with_hide_self_false(self, browser, tmp_path):
        """hide_self=false: zoom +/- stay visible while in fullscreen,
        together with the fullscreen button."""
        page, errors = self._make_page(
            browser, tmp_path, hide_self=False, hide_others=False
        )
        try:
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            self._enter_fullscreen(page)
            displays = self._zoom_displays(page)
            assert displays["zoomIn"] == "flex", displays
            assert displays["zoomOut"] == "flex", displays
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_zoom_visible_after_exit_fullscreen(self, browser, tmp_path):
        """hide_self=true: zoom +/- are visible again after exit."""
        page, errors = self._make_page(
            browser, tmp_path, hide_self=True, hide_others=False
        )
        try:
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            self._enter_fullscreen(page)
            self._exit_fullscreen(page)
            displays = self._zoom_displays(page)
            assert displays["zoomIn"] == "flex", displays
            assert displays["zoomOut"] == "flex", displays
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_hide_others_overrides_inline_display(self, browser, tmp_path):
        """hide_others hides sibling controls even with inline display styles.

        `.foliplus-fullscreen-hidden` uses `display: none !important` so it
        wins over inline `display` set by third-party Leaflet plugins.
        """
        page, errors = self._make_page(
            browser, tmp_path, hide_self=False, hide_others=True
        )
        try:
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            # Inject a sibling control with inline display:block (like a
            # third-party Leaflet plugin would set).
            page.evaluate(
                """() => {
                    const div = document.createElement('div');
                    div.className = 'leaflet-bar leaflet-control custom-ctrl';
                    div.style.display = 'block';
                    div.innerHTML = 'custom';
                    document
                        .querySelector('.leaflet-top.leaflet-right')
                        .appendChild(div);
                }"""
            )
            page.wait_for_selector(".custom-ctrl", state="attached", timeout=10000)
            self._enter_fullscreen(page)
            hidden = page.evaluate(
                """() => {
                    const el = document.querySelector('.custom-ctrl');
                    return el.classList.contains('foliplus-fullscreen-hidden')
                        && getComputedStyle(el).display === 'none';
                }"""
            )
            assert hidden, "sibling control with inline display was not hidden"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()
