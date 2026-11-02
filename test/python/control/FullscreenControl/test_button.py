"""Button-render browser tests for foliplus.FullscreenControl."""

from __future__ import annotations

from conftest import _js, use_page

from .helper import _make_page


class TestFullscreenButtonBrowser:
    """Browser-level presence/state checks for the toggle button."""

    def test_button_exists(self, browser, tmp_path):
        """FullscreenControl button is present in the DOM."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            has_btn = page.evaluate(_js("FullscreenControl/read_toggle_button"))
            assert has_btn, "FullscreenControl button not found"
            assert not errors, f"JS errors: {errors}"

    def test_maximize_svg_default(self, browser, tmp_path):
        """FullscreenControl button shows maximize SVG by default."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            svg = page.evaluate(_js("FullscreenControl/read_toggle_svg"))
            assert svg, "No SVG icon found"
            path_d = page.evaluate(_js("FullscreenControl/read_toggle_path_d"))
            # Maximize icon has M8 3H5...
            assert "M8 3H5" in path_d
            assert not errors, f"JS errors: {errors}"

    def test_hide_self(self, browser, tmp_path):
        """hide_self=true hides fullscreen button when fullscreen."""
        with use_page(_make_page, browser, tmp_path, hide_self=True) as (
            page,
            errors,
        ):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            has_self_hide = page.evaluate(
                _js("FullscreenControl/read_toggle_has_no_minimize")
            )
            assert has_self_hide
            assert not errors, f"JS errors: {errors}"
