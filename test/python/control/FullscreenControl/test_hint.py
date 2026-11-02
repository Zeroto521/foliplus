"""Hint-fire browser tests for foliplus.FullscreenControl."""

from __future__ import annotations

from conftest import _js, use_page

from .helper import (
    _enter_fullscreen,
    _exit_fullscreen,
    _make_page,
)


class TestFullscreenHintBrowser:
    """Browser-level assertions on showHint call counts."""

    def test_show_hint_once_per_toggle(self, browser, tmp_path):
        """showHint fires exactly once per fullscreen transition.

        updateUI is driven by the `fullscreenchange` event, so the
        requestFullscreen/exitFullscreen `.then()` callbacks must not call
        updateUI again (which would double-fire the hint).
        """
        with use_page(
            _make_page, browser, tmp_path, hide_self=True, hide_others=False
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            # Wrap showHint to count calls (per-map hint on map.foliplus).
            page.evaluate(_js("FullscreenControl/wrap_hint_counter"))
            _enter_fullscreen(page, hide_self=True)
            page.wait_for_timeout(200)
            enter_count = page.evaluate(_js("FullscreenControl/read_hint_count"))
            assert enter_count == 1, f"enter hint fired {enter_count} times"
            # Icon switched to MINIMIZE (path M8 3v3...)
            icon = page.evaluate(_js("FullscreenControl/read_toggle_path_d"))
            assert "M8 3v3" in icon, f"icon not switched to MINIMIZE: {icon}"

            _exit_fullscreen(page)
            page.wait_for_timeout(200)
            total = page.evaluate(_js("FullscreenControl/read_hint_count"))
            assert total == 2, f"exit hint fired {total - enter_count} times"
            assert not errors, f"JS errors: {errors}"
