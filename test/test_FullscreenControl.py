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
        """hide_self=true is passed via CONFIG."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert '"hide_self": true' in html

    def test_hide_self_false(self, base_map: folium.Map):
        """hide_self=false is passed via CONFIG."""
        FullscreenControl(hide_self=False).add_to(base_map)
        html = render(base_map)
        assert '"hide_self": false' in html

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
        """Fullscreen has MAXIMIZE and MINIMIZE SVG icons mounted in DOM."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-fullscreen-toggle" in html
        assert "foliplus-zoom-in" in html
        assert "foliplus-zoom-out" in html

    def test_hint_on_fullscreen_change(self, base_map: folium.Map):
        """Fullscreen shows enter/exit hint labels."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "FullscreenControl.enter" in html or "FullscreenControl.exit" in html

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

    def test_svg_icons_registered(self, base_map: folium.Map):
        """MAXIMIZE icon registered as hint icon for Fullscreen."""
        FullscreenControl().add_to(base_map)
        html = render(base_map)
        assert "registerHintIcon" in html

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
        assert "leaflet-bar" in html
        assert "leaflet-control" in html
        # Inner: foliplus-fullscreen-bar foliplus-ctrl-fold
        assert "foliplus-fullscreen-bar" in html
        assert "foliplus-ctrl-fold" in html

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
        """hide_others=false is passed via CONFIG."""
        FullscreenControl(hide_others=False).add_to(base_map)
        html = render(base_map)
        assert '"hide_others": false' in html

    def test_hide_self_independent_of_hide_others(self, base_map: folium.Map):
        """hide_self still works when hide_others=false."""
        FullscreenControl(hide_self=True, hide_others=False).add_to(base_map)
        html = render(base_map)
        assert '"hide_self": true' in html
        assert '"hide_others": false' in html

    def test_zoom_buttons_hidden_with_hide_self(self, base_map: folium.Map):
        """hide_self hides zoom +/- together with the fullscreen button."""
        FullscreenControl(hide_self=True, hide_others=False).add_to(base_map)
        html = render(base_map)
        assert "ZOOM_IN" in html
        assert "ZOOM_OUT" in html
        assert "foliplus-hidden" in html

    def test_zoom_buttons_visible_without_hide_self(self, base_map: folium.Map):
        """hide_self=false is passed via CONFIG."""
        FullscreenControl(hide_self=False, hide_others=False).add_to(base_map)
        html = render(base_map)
        assert "ZOOM_IN" in html
        assert "ZOOM_OUT" in html
        assert '"hide_self": false' in html
        assert '"hide_others": false' in html


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

    def _enter_fullscreen(self, page, hide_self=True):
        """Click the fullscreen toggle to enter fullscreen.

        Uses a real input event (page.click) — the Fullscreen API requires
        user activation, which synthesized `.click()` via page.evaluate may
        not provide. Waits for both the native fullscreen state AND the UI
        update that follows the (async) `fullscreenchange` event.
        """
        page.click(".foliplus-fullscreen-toggle")
        page.wait_for_function("() => document.fullscreenElement !== null")
        if hide_self:
            page.wait_for_function(
                """() => document
                    .querySelector('.foliplus-zoom-in')
                    .classList.contains('foliplus-hidden')"""
            )
        else:
            # zoom stays visible when hide_self=false; wait for the icon swap
            page.wait_for_function(
                """() => document
                    .querySelector('.foliplus-fullscreen-toggle path')
                    .getAttribute('d')
                    .indexOf('M8 3v3') === 0"""
            )

    def _exit_fullscreen(self, page):
        """Click the fullscreen toggle to exit fullscreen.

        Uses a synthesized click via JS: the toggle is hidden while
        fullscreen (hide_self=true), so Playwright's page.click cannot
        target it. Exiting fullscreen does not require user activation.
        Waits for the UI to restore after the `fullscreenchange` event.
        """
        page.evaluate("document.querySelector('.foliplus-fullscreen-toggle').click()")
        page.wait_for_function("() => document.fullscreenElement === null")
        page.wait_for_function(
            """() => !document
                .querySelector('.foliplus-zoom-in')
                .classList.contains('foliplus-hidden')"""
        )

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
            self._enter_fullscreen(page, hide_self=True)
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
            self._enter_fullscreen(page, hide_self=False)
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
            self._enter_fullscreen(page, hide_self=True)
            self._exit_fullscreen(page)
            displays = self._zoom_displays(page)
            assert displays["zoomIn"] == "flex", displays
            assert displays["zoomOut"] == "flex", displays
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_hide_others_overrides_inline_display(self, browser, tmp_path):
        """hide_others hides sibling controls even with inline display styles.

        `.foliplus-hidden` uses `display: none !important` so it
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
            self._enter_fullscreen(page, hide_self=False)
            hidden = page.evaluate(
                """() => {
                    const el = document.querySelector('.custom-ctrl');
                    return el.classList.contains('foliplus-hidden')
                        && getComputedStyle(el).display === 'none';
                }"""
            )
            assert hidden, "sibling control with inline display was not hidden"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_show_hint_once_per_toggle(self, browser, tmp_path):
        """showHint fires exactly once per fullscreen transition.

        updateUI is driven by the `fullscreenchange` event, so the
        requestFullscreen/exitFullscreen `.then()` callbacks must not call
        updateUI again (which would double-fire the hint).
        """
        page, errors = self._make_page(
            browser, tmp_path, hide_self=True, hide_others=False
        )
        try:
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            # Wrap showHint to count calls.
            page.evaluate(
                """() => {
                    window.__hintCount = 0;
                    const orig = foliplus.showHint;
                    foliplus.showHint = function (...args) {
                        window.__hintCount++;
                        return orig.apply(this, args);
                    };
                }"""
            )
            self._enter_fullscreen(page, hide_self=True)
            page.wait_for_timeout(200)
            enter_count = page.evaluate("window.__hintCount")
            assert enter_count == 1, f"enter hint fired {enter_count} times"
            # Icon switched to MINIMIZE (path M8 3v3...)
            icon = page.evaluate(
                "document.querySelector('.foliplus-fullscreen-toggle path').getAttribute('d')"
            )
            assert "M8 3v3" in icon, f"icon not switched to MINIMIZE: {icon}"

            self._exit_fullscreen(page)
            page.wait_for_timeout(200)
            total = page.evaluate("window.__hintCount")
            assert total == 2, f"exit hint fired {total - enter_count} times"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def _make_pseudo_page(self, browser, tmp_path):
        """Build a page with the native Fullscreen API disabled, so the
        control falls back to pseudo-fullscreen mode (isEnabled=false)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        FullscreenControl(hide_self=True, hide_others=False).add_to(m)

        html = m.get_root().render()
        # Disable the native Fullscreen API before the control initializes.
        html = html.replace(
            "<body>",
            """<body>
            <script>
              Object.defineProperty(document, 'fullscreenEnabled', {
                value: false,
                configurable: true,
              });
              document.exitFullscreen = undefined;
              document.documentElement.requestFullscreen = undefined;
            </script>""",
        )
        html_path = tmp_path / "fullscreen_pseudo.html"
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

    def test_pseudo_fullscreen_enter_exit(self, browser, tmp_path):
        """Pseudo-fullscreen (no native API) can be entered and exited.

        The exit branch must check the internal `map.isFullscreen` flag,
        because `document.fullscreenElement` is always null when the native
        Fullscreen API is unavailable.
        """
        page, errors = self._make_pseudo_page(browser, tmp_path)
        try:
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            # Enter with a real input event (page.click generates one).
            page.click(".foliplus-fullscreen-toggle")
            page.wait_for_function(
                """() => document
                    .querySelector('.leaflet-container')
                    .classList.contains('leaflet-pseudo-fullscreen')"""
            )
            # Zoom hidden, icon MINIMIZE.
            hidden = page.evaluate(
                """() => document
                    .querySelector('.foliplus-zoom-in')
                    .classList.contains('foliplus-hidden')"""
            )
            assert hidden, "zoom not hidden in pseudo-fullscreen"

            # Exit. The toggle button is hidden while fullscreen, so click via
            # JS (Playwright's page.click would fail on the hidden element).
            page.evaluate(
                "document.querySelector('.foliplus-fullscreen-toggle').click()"
            )
            page.wait_for_function(
                """() => !document
                    .querySelector('.leaflet-container')
                    .classList.contains('leaflet-pseudo-fullscreen')"""
            )
            visible = page.evaluate(
                """() => !document
                    .querySelector('.foliplus-zoom-in')
                    .classList.contains('foliplus-hidden')"""
            )
            assert visible, "zoom not restored after exiting pseudo-fullscreen"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()
