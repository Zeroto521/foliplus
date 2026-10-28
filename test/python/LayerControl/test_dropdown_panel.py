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
import pytest
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


# ─────────────────── value-fill row geometry ───────────────────
#
# The shared dropdown replaced the panels' native selects, and two layouts only
# a real browser resolves: the closed row (a flex min-width trap — the wrapper's
# automatic minimum is the nowrap label) and the open popup (it has to spell out
# a label the fixed-width row ellipsizes, without leaving the panel). Measured
# here rather than asserted in jsdom, which computes neither flex nor text.

_GEOMETRY = _js("LayerControl/read_fill_row_geometry")

_TO_RAMP = """() => {
  const select = document.querySelector('.foliplus-style-fill-mode-select');
  if (!select) return false;
  select.value = 'ramp';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}"""

# The English method name is what breaks the row: 93px of nowrap text in a
# 104px control, next to the fixed 52px class count. Chinese is the geometry
# the row was designed against, so it doubles as the "nothing moved" control.
_METHOD_TEXT = {"en": "Natural Breaks", "zh": "自然断点"}


def _make_geometry_page(browser, tmp_path, locale):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    features = [
        {
            "type": "Feature",
            "properties": {
                "score": 10 + i,
                # A data-driven label wider than the 160px control cell: the
                # open list has to stop at the cell, not grow past the panel.
                "population_density_2020_index": 100 + i,
            },
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
    ]
    folium.GeoJson(
        json.dumps({"type": "FeatureCollection", "features": features}),
        name="Polygon data",
    ).add_to(m)
    LayerControl(locale=locale).add_to(m)
    return make_browser_page(
        browser, tmp_path, m.get_root().render(), f"geometry_{locale}"
    )


def _open_ramp_row(page) -> None:
    _open_drawer(page)
    assert page.evaluate(_TO_RAMP), "the fill row has no mode control"
    page.wait_for_timeout(200)


class TestFillRowGeometryBrowser:
    @pytest.mark.parametrize("locale", ["en", "zh"])
    def test_the_inline_group_fits_the_control_cell(self, browser, tmp_path, locale):
        with use_page(
            lambda b, t: _make_geometry_page(b, t, locale), browser, tmp_path
        ) as (page, errors):
            _open_ramp_row(page)
            got = page.evaluate(_GEOMETRY)
            assert "error" not in got, got
            # The page really rendered this locale before any geometry is read.
            assert got["methodLabel"] == _METHOD_TEXT[locale], got

            # Method + gap + Classes is one cell, not more: the group may not
            # overflow the control column (before the wrapper's min-width: 0 the
            # English row measured 122.6 + 4 + 52 against a 160px cell).
            gap = got["classes"]["left"] - got["method"]["right"]
            assert got["method"]["w"] + gap + got["classes"]["w"] <= (
                got["control"]["w"] + 0.5
            ), got
            assert got["inline"]["w"] <= got["control"]["w"] + 0.5, got
            assert got["classes"]["right"] <= got["control"]["right"] + 0.5, got
            # Nothing spills out of the drawer either.
            assert got["panelScrollX"] == 0, got

            # The row is fixed width, so the closed control shortens the label —
            # but it must be an ellipsis (with the full name on the tooltip and
            # the accessible name), never a hard clip and never an overflow.
            if locale == "en":
                assert got["ellipsized"] is True, got
            else:
                assert got["ellipsized"] is False, got
            assert got["title"], got
            assert got["ariaLabel"], got

    @pytest.mark.parametrize("locale", ["en", "zh"])
    def test_the_open_list_spells_the_label_out_without_leaving_the_cell(
        self, browser, tmp_path, locale
    ):
        with use_page(
            lambda b, t: _make_geometry_page(b, t, locale), browser, tmp_path
        ) as (page, errors):
            _open_ramp_row(page)
            got = page.evaluate(_GEOMETRY)
            assert "error" not in got, got

            method_list = got["methodList"]
            assert method_list, "the method popup did not open"
            # The row ellipsizes the label on purpose, so the popup reclaims the
            # width it needs — and stops at the cell's right edge.
            assert method_list["w"] >= got["method"]["w"] - 0.5, (method_list, got)
            assert method_list["right"] <= got["control"]["right"] + 0.5, (
                method_list,
                got,
            )
            truncated = [o["text"] for o in method_list["labels"] if o["truncated"]]
            assert truncated == [], (
                "the open method list truncates the very label the row implies "
                f"it can show: {truncated}"
            )

            # A data-driven label (a field name) can be wider than the cell: the
            # popup then stops at the cell instead of growing past the panel.
            field_list = got["fieldList"]
            assert field_list, "the field popup did not open"
            assert field_list["right"] <= field_list["controlRight"] + 0.5, (
                field_list,
            )
            assert not errors, f"JS errors: {errors}"
