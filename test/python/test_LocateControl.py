"""Tests for foliplus.LocateControl."""

from __future__ import annotations

import folium
import pytest
from conftest import (
    _js,
    assert_config_value,
    assert_locale,
    make_browser_page,
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
