"""Tests for foliplus.LocateControl."""

from __future__ import annotations

import re

import folium
import pytest
from conftest import (
    _js,
    assert_config_value,
    assert_locale,
    make_browser_page,
    read_css,
    read_css_dir,
    render_control,
    use_page,
)

from foliplus import LocateControl


class TestLocateControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert LocateControl()._name == "LocateControl"

    def test_default_zoom(self):
        assert LocateControl().zoom == 15

    def test_custom_zoom(self):
        assert LocateControl(zoom=16).zoom == 16

    def test_default_position(self):
        assert LocateControl().position == "bottomright"

    def test_custom_position(self):
        assert LocateControl(position="topleft").position == "topleft"

    def test_default_locale(self):
        assert LocateControl()._locale_code == ""

    def test_custom_locale(self):
        assert LocateControl(locale="zh")._locale_code == "zh"

    def test_invalid_zoom_raises_too_low(self):
        """Zoom below 1 raises ValueError."""
        with pytest.raises(ValueError, match="zoom must be an int between 1 and 18"):
            LocateControl(zoom=0)

    def test_invalid_zoom_raises_too_high(self):
        """Zoom above 18 raises ValueError."""
        with pytest.raises(ValueError, match="zoom must be an int between 1 and 18"):
            LocateControl(zoom=19)


class TestLocateControlRendering:
    """Rendering output tests (stable across minification)."""

    def test_rendered_content(self):
        """Key content is present in rendered output."""
        html = render_control(LocateControl())
        assert "foliplus-locate-btn" in html
        assert "leaflet-bar" in html or "foliplus-ctrl-fold" in html

    def test_zoom_config(self):
        html = render_control(LocateControl())
        assert_config_value(html, "zoom", 15)

    def test_custom_zoom_config(self):
        html = render_control(LocateControl(zoom=16))
        assert_config_value(html, "zoom", 16)

    def test_loading_state_css(self):
        """The button swaps the crosshair for a spinner while locating."""
        css = read_css("foliplus/css/LocateControl.css")
        assert ".locate-btn-icon" in css
        assert ".locate-btn-loading" in css
        assert "&.loading" in css
        assert "pointer-events: none" in css

    def test_does_not_redefine_transform(self):
        """The hover/active icon scale stays with the shared stylesheet alone.

        css/common/button.css' ":hover svg" rule is a descendant selector, so it already
        scales the SVG nested inside the wrapper spans. A transform on the
        wrapper would compound with it — the icon scaled three times on hover.
        """
        css = read_css("foliplus/css/LocateControl.css")
        # Strip comments: the rationale above names "transform" in prose, and
        # this guard must only see live declarations.
        decls = [l for l in re.sub(r"/\*.*?\*/", "", css, flags=re.S).splitlines()]
        assert not [l for l in decls if "transform" in l], "transform redefined locally"

    def test_button_ships_both_icons(self):
        """The button markup carries the idle crosshair and the loading spinner."""
        html = render_control(LocateControl())
        assert "locate-btn-icon" in html
        assert "locate-btn-loading" in html
        # The spinner markup ships from the shared Icons.LOADING in common.js.
        assert "foliplus-spin" in html

    def test_spins_with_shared_keyframes(self):
        """The loading state reuses the shared foliplus spinner, no local animation."""
        # The animation lives in reset.css; LocateControl.css only toggles
        # which icon shows.
        assert "@keyframes foliplus-spin" in read_css_dir(
            "foliplus/css/common", "reset.css"
        )
        assert "@keyframes" not in read_css("foliplus/css/LocateControl.css")

    def test_contains_gcoord_dependency(self):
        """WGS-84 → map CRS conversion needs gcoord."""
        html = render_control(LocateControl())
        assert "gcoord.global.prod.js" in html

    def test_locale_zh(self):
        html = render_control(LocateControl(locale="zh"))
        assert_locale(html, "定位", "LocateControl.title")

    def test_locale_en(self):
        html = render_control(LocateControl(locale="en"))
        assert_locale(html, "Locate", "LocateControl.title")


class TestLocateControlBrowser:
    """Browser-based smoke tests for LocateControl."""

    def _make_page(self, browser, tmp_path):
        """Build a page with LocateControl and return (page, errors)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LocateControl().add_to(m)
        html = m.get_root().render()
        page, errors = make_browser_page(browser, tmp_path, html, "locate")
        page.wait_for_selector(".foliplus-locate-btn", state="attached", timeout=10000)
        return page, errors

    def test_button_present(self, browser, tmp_path):
        """The locate button is rendered by default."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            has_btn = page.evaluate(
                "document.querySelector('.foliplus-locate-btn') !== null"
            )
            assert has_btn, "Locate button not found"
            assert not errors, f"JS errors: {errors}"

    def test_click_triggers_geolocation(self, browser, tmp_path):
        """Clicking the button calls navigator.geolocation.getCurrentPosition."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            called = page.evaluate(_js("LocateControl/click"))
            assert called, "geolocation.getCurrentPosition was not invoked on click"
            page.wait_for_selector(".foliplus-pin", state="attached", timeout=5000)
            assert not errors, f"JS errors: {errors}"

    def test_geolocation_unsupported_shows_hint(self, browser, tmp_path):
        """Missing navigator.geolocation shows an error hint, no JS errors."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("LocateControl/geolocation_unsupported"))
            page.wait_for_timeout(300)
            assert not errors, f"JS errors: {errors}"

    def test_click_places_marker(self, browser, tmp_path):
        """Clicking with geolocation success places a location marker."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("LocateControl/click_success"))
            page.wait_for_selector(".foliplus-pin", state="attached", timeout=5000)
            # The marker's popup should show the located coordinates.
            popup = page.evaluate(_js("LocateControl/read_popup"))
            assert popup and "119.3" in popup and "26.08" in popup, (
                f"Expected located coords in popup, got: {popup!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_button_spins_while_locating(self, browser, tmp_path):
        """While geolocation is in flight the crosshair swaps for the spinner."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(_js("LocateControl/locate_pending"))
            assert state["loading"], f"button not marked loading: {state!r}"
            assert state["spinnerVisible"], f"spinner not shown: {state!r}"
            assert state["spinnerAnimating"], f"spinner not animating: {state!r}"
            assert not state["iconVisible"], f"crosshair still shown: {state!r}"
            assert not errors, f"JS errors: {errors}"

    def test_button_returns_to_idle_after_locate(self, browser, tmp_path):
        """Once geolocation settles the spinner gives way to the crosshair."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("LocateControl/locate_pending"))
            # The loading class is cleared synchronously in the success
            # callback, before flyTo animates, so no marker wait is needed.
            state = page.evaluate(_js("LocateControl/locate_resolve"))
            assert not state["loading"], f"loading class stuck: {state!r}"
            assert state["iconVisible"], f"crosshair not restored: {state!r}"
            assert not state["spinnerVisible"], f"spinner still shown: {state!r}"
            assert not errors, f"JS errors: {errors}"

    def test_button_spins_on_geolocation_error(self, browser, tmp_path):
        """A rejected geolocation clears the spinner too."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(_js("LocateControl/locate_reject"))
            assert state["loading"], f"spinner not shown before the reject: {state!r}"
            assert state["spinnerVisible"], f"spinner not shown: {state!r}"
            assert not state["iconVisible"], f"crosshair not hidden: {state!r}"
            assert not state["loadingAfter"], f"loading stuck after reject: {state!r}"
            assert not state["spinnerVisibleAfter"], (
                f"spinner stuck after reject: {state!r}"
            )
            assert not errors, f"JS errors: {errors}"
