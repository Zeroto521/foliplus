"""Zoom-button visibility browser tests for foliplus.FullscreenControl."""

from __future__ import annotations

from conftest import _js, use_page

from .helper import (
    _enter_fullscreen,
    _exit_fullscreen,
    _make_page,
    _zoom_displays,
)


class TestFullscreenZoomBrowser:
    """Browser-level zoom/+/- visibility checks around fullscreen."""

    def test_zoom_visible_in_fullscreen_with_hide_self(self, browser, tmp_path):
        """hide_self=true hides the toggle, not the zoom +/- buttons."""
        with use_page(
            _make_page, browser, tmp_path, hide_self=True, hide_others=False
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            _enter_fullscreen(page, hide_self=True)
            # The bar is the only zoom left while fullscreen (Leaflet's own
            # control is replaced), so hide_self must not hide it.
            displays = _zoom_displays(page)
            assert displays["zoomIn"] == "flex", displays
            assert displays["zoomOut"] == "flex", displays
            assert page.evaluate(_js("FullscreenControl/read_toggle_hidden"))
            assert not page.evaluate(_js("FullscreenControl/read_zoom_hidden")), (
                "hide_self must not mark the zoom buttons hidden"
            )
            assert not errors, f"JS errors: {errors}"

    def test_zoom_visible_with_hide_self_false(self, browser, tmp_path):
        """hide_self=false: zoom +/- stay visible while in fullscreen,
        together with the fullscreen button."""
        with use_page(
            _make_page, browser, tmp_path, hide_self=False, hide_others=False
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            _enter_fullscreen(page, hide_self=False)
            displays = _zoom_displays(page)
            assert displays["zoomIn"] == "flex", displays
            assert displays["zoomOut"] == "flex", displays
            assert not page.evaluate(_js("FullscreenControl/read_toggle_hidden"))
            assert not errors, f"JS errors: {errors}"

    def test_zoom_visible_after_exit_fullscreen(self, browser, tmp_path):
        """hide_self=true: zoom +/- are visible again after exit."""
        with use_page(
            _make_page, browser, tmp_path, hide_self=True, hide_others=False
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            _enter_fullscreen(page, hide_self=True)
            _exit_fullscreen(page)
            displays = _zoom_displays(page)
            assert displays["zoomIn"] == "flex", displays
            assert displays["zoomOut"] == "flex", displays
            assert not errors, f"JS errors: {errors}"

    def test_hide_others_overrides_inline_display(self, browser, tmp_path):
        """hide_others hides sibling controls even with inline display styles.

        `.foliplus-hidden` uses `display: none !important` so it
        wins over inline `display` set by third-party Leaflet plugins.
        """
        with use_page(
            _make_page, browser, tmp_path, hide_self=False, hide_others=True
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            # Inject a sibling control with inline display:block (like a
            # third-party Leaflet plugin would set).
            page.evaluate(_js("FullscreenControl/inject_sibling_control"))
            page.wait_for_selector(".custom-ctrl", state="attached", timeout=10000)
            _enter_fullscreen(page, hide_self=False)
            hidden = page.evaluate(
                _js("FullscreenControl/read_sibling_hidden_by_hide_others")
            )
            assert hidden, "sibling control with inline display was not hidden"
            assert not errors, f"JS errors: {errors}"
