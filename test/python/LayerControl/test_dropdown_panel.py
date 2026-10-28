"""Style drawer: a portalled dropdown row belongs to the panel that owns it.

Regression guard for #793. The shared dropdown's list lives on <body> while it
is open. Two registry consumers decide what happens to that press:

- core/overlay's isInsideOverlay (the row panel's own dismiss predicate), and
- core/leaflet/panel's bindOutsideCollapse (the panel collapse binding, which
  sampled only container.contains before the fix).

A press on a row must keep the row panel expanded and the drawer on screen; a
press on the map must still dismiss the drawer (the fix must not disarm the
dismissal). Escape closes the popup only — the drawer and the row panel stay.
"""

from __future__ import annotations

import json

import folium
from conftest import _js, make_browser_page, panel_ready, use_page

from foliplus import HeatmapControl, LayerControl

STATE = """() => {
  const rowPanel = document.querySelector('.foliplus-layer-ctrl');
  const drawer = document.querySelector('.foliplus-layer-style-panel');
  return {
    rowPanelExpanded: rowPanel ? rowPanel.classList.contains('foliplus-is-expanded') : null,
    drawerVisible: !!drawer && drawer.getBoundingClientRect().height > 0,
    openLists: [...document.querySelectorAll('.foliplus-dropdown-list')].filter(l => !l.hidden).length,
  };
}"""

FIRST_TRIGGER = """() => {
  const drawer = document.querySelector('.foliplus-layer-style-panel');
  const el = drawer ? drawer.querySelector('.foliplus-dropdown-trigger') : null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}"""

FIRST_OPTION = """() => {
  const list = [...document.querySelectorAll('.foliplus-dropdown-list')].find(l => !l.hidden);
  const option = list ? list.querySelector('.foliplus-dropdown-option:not([disabled])') : null;
  if (!option) return null;
  const r = option.getBoundingClientRect();
  return { label: (option.textContent || '').trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}"""


def _make_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    LayerControl().add_to(m)
    # A second control on the map gives a real press target outside the layer
    # panel (the "press elsewhere ends the rename" invariant).
    HeatmapControl().add_to(m)
    data = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"value": 10 + i},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [119.28 + i * 0.01, 26.06],
                            [119.32 + i * 0.01, 26.06],
                            [119.32 + i * 0.01, 26.10],
                            [119.28 + i * 0.01, 26.10],
                            [119.28 + i * 0.01, 26.06],
                        ]
                    ],
                },
            }
            for i in range(3)
        ],
    }
    folium.GeoJson(json.dumps(data), name="Polygon data").add_to(m)
    return make_browser_page(browser, tmp_path, m.get_root().render(), "style_dropdown")


def _open_drawer(page) -> None:
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached"
    )
    panel_ready(page)
    opened = page.evaluate(_js("LayerControl/open_style_panel"))
    assert opened["ok"], opened
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible")


class TestStyleDrawerDropdownBrowser:
    def test_a_press_on_a_row_keeps_both_panels_open(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _open_drawer(page)
            trigger = page.evaluate(FIRST_TRIGGER)
            assert trigger, "the drawer has no dropdown row"
            page.mouse.click(trigger["x"], trigger["y"])
            page.wait_for_timeout(180)
            opened = page.evaluate(STATE)
            assert opened["openLists"] == 1, opened

            option = page.evaluate(FIRST_OPTION)
            assert option, "the popup has no enabled row"
            page.mouse.click(option["x"], option["y"])
            page.wait_for_timeout(220)
            after = page.evaluate(STATE)
            assert after["openLists"] == 0, after
            assert after["rowPanelExpanded"], (
                "pressing a portalled row collapsed the row panel"
            )
            assert after["drawerVisible"], "pressing a row dismissed the style drawer"
            assert not errors, f"JS errors: {errors}"

    def test_escape_closes_the_popup_only(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _open_drawer(page)
            trigger = page.evaluate(FIRST_TRIGGER)
            page.mouse.click(trigger["x"], trigger["y"])
            page.wait_for_timeout(180)
            assert page.evaluate(STATE)["openLists"] == 1

            page.keyboard.press("Escape")
            page.wait_for_timeout(220)
            after = page.evaluate(STATE)
            assert after["openLists"] == 0, after
            assert after["drawerVisible"], (
                "Escape closed the drawer, not just the popup"
            )
            assert after["rowPanelExpanded"], after
            assert not errors, f"JS errors: {errors}"

    def test_opening_the_drawer_ends_an_inline_rename(self, browser, tmp_path):
        """Invariant behind the popup claiming Escape on window capture.

        A dropdown is only reachable from the style drawer, and opening the
        drawer ends a live row rename (the input leaves the DOM and focus
        returns to the row). That is why no surface ranked above the popup in
        core/overlayRegistry's ESC_PRIORITY can be open at the same time, so
        claiming Escape on window capture cannot steal a rename cancel.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached"
            )
            panel_ready(page)
            page.evaluate(_js("LayerControl/rename_first_layer"))
            page.wait_for_timeout(250)
            assert page.evaluate(
                "() => !!document.querySelector('.foliplus-layer-rename-input')"
            ), "the rename input did not open"

            opened = page.evaluate(_js("LayerControl/open_style_panel"))
            assert opened["ok"], opened
            page.wait_for_timeout(250)
            assert page.evaluate(
                "() => !!document.querySelector('.foliplus-layer-style-panel')"
            )
            assert not page.evaluate(
                "() => !!document.querySelector('.foliplus-layer-rename-input')"
            ), (
                "opening the style drawer left the row rename live; the popup's "
                "window-capture Escape could then steal the rename's cancel"
            )
            assert not errors, f"JS errors: {errors}"

    def test_a_real_press_on_another_panel_ends_the_rename(self, browser, tmp_path):
        """The rename ends before any other surface can take focus.

        The popup claims Escape on window capture, ahead of the document-level
        overlay dispatcher. That is only safe because a live rename cannot
        coexist with a popup: a real pointer press anywhere outside the rename —
        here on the heatmap panel's toggle — ends it first. This test pins the
        second path (the style-drawer path is pinned above).
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(".foliplus-heatmap-ctrl", state="attached")
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached"
            )
            panel_ready(page)
            page.evaluate(_js("LayerControl/rename_first_layer"))
            page.wait_for_timeout(250)
            assert page.evaluate(
                "() => !!document.querySelector('.foliplus-layer-rename-input')"
            ), "the rename input did not open"

            toggle = page.evaluate(
                """() => {
                  const el = document.querySelector(
                    '.foliplus-heatmap-ctrl .foliplus-toggle-btn'
                  );
                  const r = el.getBoundingClientRect();
                  return { x: Math.round(r.left + r.width / 2),
                           y: Math.round(r.top + r.height / 2) };
                }"""
            )
            page.mouse.click(toggle["x"], toggle["y"])
            page.wait_for_timeout(300)
            assert not page.evaluate(
                "() => !!document.querySelector('.foliplus-layer-rename-input')"
            ), (
                "a real press on another panel left the row rename live; the "
                "popup's window-capture Escape could then steal the rename cancel"
            )
            assert not errors, f"JS errors: {errors}"

    def test_an_outside_press_still_dismisses_the_drawer(self, browser, tmp_path):
        """The portal ownership must not disarm the panel's own dismissal."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _open_drawer(page)
            page.mouse.click(5, 5)
            page.wait_for_timeout(260)
            after = page.evaluate(STATE)
            assert after["drawerVisible"] is False, (
                "an outside press no longer dismisses the style drawer"
            )
            assert not errors, f"JS errors: {errors}"
