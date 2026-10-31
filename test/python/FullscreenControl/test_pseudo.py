"""Pseudo-fullscreen and policy-reject browser tests for foliplus.FullscreenControl.

These three tests exercise the non-native-Fullscreen-API paths:

* ``_make_pseudo_page`` disables the API before the control script runs, so
  the control falls back to pseudo-fullscreen mode.
* Late-downgrade keeps the native API alive at load time and flips
  ``document.fullscreenEnabled`` to ``False`` only after every module has
  been evaluated — a lazy ``isEnabled`` read is the only implementation
  that survives.
* Reject patches ``requestFullscreen`` to always fail — the realistic
  shape of a browser-policy denial.
"""

from __future__ import annotations

import folium
from conftest import _js, make_browser_page, use_page

from foliplus import FullscreenControl

from .helper import _make_pseudo_page


def _native_html(locale: str | None = None) -> str:
    """Render a native-fullscreen page for browser tests.

    Pass ``locale="en"`` only for gates that read hint text: the hint string
    is locale-dependent, and Playwright's default browser language is not
    something those gates should depend on. Gates that only inspect DOM
    state should leave it unset so the page renders with the ambient locale.
    """
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    FullscreenControl(hide_self=True, hide_others=False, locale=locale).add_to(m)
    return m.get_root().render()


class TestFullscreenPseudoBrowser:
    """Browser tests for the pseudo-fullscreen and reject paths."""

    def test_pseudo_fullscreen_enter_exit(self, browser, tmp_path):
        """Pseudo-fullscreen (no native API) can be entered and exited.

        The exit branch must check the internal `map.isFullscreen` flag,
        because `document.fullscreenElement` is always null when the native
        Fullscreen API is unavailable.
        """
        with use_page(_make_pseudo_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            # Enter with a real input event (page.click generates one).
            page.click(".foliplus-fullscreen-toggle")
            page.wait_for_function(_js("FullscreenControl/read_pseudo_fullscreen_on"))
            # Zoom hidden.
            hidden = page.evaluate(_js("FullscreenControl/read_zoom_hidden"))
            assert hidden, "zoom not hidden in pseudo-fullscreen"

            # Exit. The toggle button is hidden while fullscreen, so click
            # via JS (Playwright's page.click would fail on the hidden element).
            page.evaluate(_js("FullscreenControl/click_toggle"))
            page.wait_for_function(_js("FullscreenControl/read_pseudo_fullscreen_off"))
            visible = page.evaluate(_js("FullscreenControl/read_zoom_visible"))
            assert visible, "zoom not restored after exiting pseudo-fullscreen"
            assert not errors, f"JS errors: {errors}"

    def test_pseudo_fullscreen_after_late_downgrade(self, browser, tmp_path):
        """Downgrading AFTER the bundle loads still routes to pseudo-fullscreen.

        `document.fullscreenEnabled` is document-level state that can flip at
        runtime (iframe policy, embedder restrictions). `isEnabled` must be
        re-read per call — a module-load-time snapshot would pin the native
        branch for every later toggle.

        This is deliberately distinct from `_make_pseudo_page`: that fixture
        defines the flag *before* the control script runs, so a snapshot read
        and a lazy read both see `false` and the test cannot tell them apart.
        Here the page loads with a fully working native API and the flag flips
        only after, so only the lazy implementation reaches the pseudo path.
        """
        page, errors = make_browser_page(
            browser, tmp_path, _native_html(), "fullscreen_late_downgrade"
        )
        try:
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            # Native API is intact at load time — this is the precondition
            # that makes a snapshot read take the native branch.
            assert (
                page.evaluate(_js("FullscreenControl/read_fullscreen_enabled")) is True
            )
            assert (
                page.evaluate(_js("FullscreenControl/read_exit_fullscreen_type"))
                == "function"
            )

            # Flip the flag only now, after every module has been evaluated.
            page.evaluate(_js("FullscreenControl/disable_fullscreen_enabled"))
            assert (
                page.evaluate(_js("FullscreenControl/read_fullscreen_enabled")) is False
            )

            page.click(".foliplus-fullscreen-toggle")
            page.wait_for_function(_js("FullscreenControl/read_pseudo_fullscreen_on"))
            # A snapshot read would have called requestFullscreen() instead —
            # no native fullscreen session, and the container carries the
            # pseudo class.
            assert (
                page.evaluate(_js("FullscreenControl/read_fullscreen_element")) is None
            )
            hidden = page.evaluate(_js("FullscreenControl/read_zoom_hidden"))
            assert hidden, "zoom not hidden after a late downgrade to pseudo mode"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_native_reject_falls_back_to_pseudo(self, browser, tmp_path):
        """A rejected requestFullscreen falls back to pseudo-fullscreen.

        The native API is present but every request fails — the realistic
        shape of a browser policy denial. Reject must not dead-end on a
        hint: the container lands in pseudo mode so the click still
        maximizes the map, and the hint explains the fallback instead of
        announcing "Entered fullscreen" for a click that just failed.
        """
        page, errors = make_browser_page(
            browser, tmp_path, _native_html(locale="en"), "fullscreen_reject"
        )
        try:
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            # Policy denial: the API is available but the container refuses.
            page.evaluate(_js("FullscreenControl/simulate_request_fullscreen_reject"))
            page.click(".foliplus-fullscreen-toggle")
            page.wait_for_function(
                _js("FullscreenControl/read_hint_says_fallback"),
                timeout=5000,
            )

            # Pseudo mode engaged; no native fullscreen session exists.
            assert (
                page.evaluate(_js("FullscreenControl/read_fullscreen_element")) is None
            )
            assert page.evaluate(_js("FullscreenControl/read_pseudo_fullscreen_on"))
            # The pseudo UI applied (hide_self hides the zoom buttons).
            hidden = page.evaluate(_js("FullscreenControl/read_zoom_hidden"))
            assert hidden, "zoom not hidden after the pseudo fallback"
            # And the user is told the truth instead of "entered fullscreen".
            hint = page.evaluate(_js("FullscreenControl/read_hint_text"))
            assert "maximized" in hint.lower(), f"unexpected reject hint: {hint!r}"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()
