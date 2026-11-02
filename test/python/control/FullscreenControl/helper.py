"""Shared helpers for FullscreenControl browser tests."""

from __future__ import annotations

import re

import folium
from conftest import _js, make_browser_page, snippet

from foliplus import FullscreenControl


def _expose_ctrl(html: str) -> str:
    """Expose the FullscreenControl instance as ``window.__fullscreenCtrl``.

    The control is constructed inline — ``new FullscreenControl({...}).addTo(map)``
    — so the statement is rewritten to assign the *instance*. Reaching for
    the matched identifier alone would hand us the constructor, not the
    instance.
    """
    match = re.search(r"new ([A-Za-z0-9_$.]+)\(([^)]*)\)\.addTo\(map\);", html)
    if not match:
        return html
    ctor, args = match.group(1), match.group(2)
    return (
        html[: match.start()]
        + f"window.__fullscreenCtrl = new {ctor}({args}).addTo(map);"
        + html[match.end() :]
    )


def _make_page(
    browser,
    tmp_path,
    *,
    hide_self=True,
    hide_others=False,
    expose_ctrl=False,
    prelude=None,
):
    """Build a page with FullscreenControl and return (page, errors).

    ``hide_self`` / ``hide_others`` are forwarded to ``FullscreenControl``.
    ``expose_ctrl`` rewrites the render to expose the control instance on
    ``window``. ``prelude`` is installed via ``page.add_init_script`` before
    the page's own scripts run — used to plant listener-counting probes.
    """
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    FullscreenControl(hide_self=hide_self, hide_others=hide_others).add_to(m)
    html = m.get_root().render()
    if expose_ctrl:
        html = _expose_ctrl(html)
    return make_browser_page(browser, tmp_path, html, "fullscreen", prelude=prelude)


def _enter_fullscreen(page, hide_self=True):
    """Click the fullscreen toggle to enter fullscreen.

    Uses a real input event (``page.click``) — the Fullscreen API requires
    user activation, which synthesized ``.click()`` via ``page.evaluate`` may
    not provide. Waits for both the native fullscreen state AND the UI
    update that follows the (async) ``fullscreenchange`` event.
    """
    page.click(".foliplus-fullscreen-toggle")
    page.wait_for_function(_js("FullscreenControl/wait_fullscreen_element_present"))
    if hide_self:
        page.wait_for_function(_js("FullscreenControl/read_zoom_hidden"))
    else:
        # zoom stays visible when hide_self=false; wait for the icon swap
        page.wait_for_function(_js("FullscreenControl/read_toggle_path_has_minimize"))


def _exit_fullscreen(page):
    """Click the fullscreen toggle to exit fullscreen.

    Uses a synthesized click via JS: the toggle is hidden while fullscreen
    (``hide_self=True``), so Playwright's ``page.click`` cannot target it.
    Exiting fullscreen does not require user activation. Waits for the UI
    to restore after the ``fullscreenchange`` event.
    """
    page.evaluate(_js("FullscreenControl/click_toggle"))
    page.wait_for_function(_js("FullscreenControl/wait_fullscreen_element_absent"))
    page.wait_for_function(_js("FullscreenControl/read_zoom_visible"))


def _zoom_displays(page) -> dict:
    """Return computed display of zoom in/out buttons."""
    return page.evaluate(_js("FullscreenControl/read_zoom_displays"))


def _make_pseudo_page(browser, tmp_path):
    """Build a page with the native Fullscreen API disabled, so the control
    falls back to pseudo-fullscreen mode (``isEnabled=False``).

    The API is disabled via an inline ``<script>`` in the rendered HTML —
    this patch lands before the control's IIFE runs, so ``isEnabled`` reads
    ``False`` from the very first check.
    """
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    FullscreenControl(hide_self=True, hide_others=False).add_to(m)

    html = m.get_root().render()
    html = html.replace(
        "<body>",
        f"<body>\n        <script>\n          {snippet('common/fullscreen_stub').strip()}\n        </script>",
    )
    html_path = tmp_path / "fullscreen_pseudo.html"
    html_path.write_text(html, encoding="utf-8")

    page = browser.new_page()
    errors: list[str] = []
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
