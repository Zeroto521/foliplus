"""The scheme list must never outlive the panel that opened it.

Both consumers portal the shared picker's list outside the panel: LayerControl's
style drawer and HeatmapControl's panel. The list is therefore not hidden when
the panel collapses, and the header, the close button and the clear button all
collapse by toggling a class, so no DOM removal is guaranteed. A user reported
the heatmap's list still floating over the map after the panel was put away.

These tests drive the real affordances in Chromium and assert that the list
disappears together with its panel — on collapse, on the clear button, on an
outside press, on control removal and in pseudo-fullscreen — and that the picker
does not swallow the next press after an item is chosen.
"""

from __future__ import annotations

import json
import re

import folium
from conftest import _js, heatmap_ready, make_browser_page, panel_ready, use_page

from foliplus import HeatmapControl, LayerControl


def _polygon_layer() -> folium.GeoJson:
    """Overlay layer with a numeric property, for the style drawer's ramp arm."""
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
    return folium.GeoJson(json.dumps(data), name="Polygon data")


def _points_group() -> folium.FeatureGroup:
    """One point layer, so the heatmap auto-selects it and opens its config."""
    fg = folium.FeatureGroup(name="Points", show=True)
    gj = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"val": 1.0 + i},
                    "geometry": {
                        "type": "Point",
                        "coordinates": [119.30 + i * 0.01, 26.08],
                    },
                }
                for i in range(3)
            ],
        }
    )
    folium.GeoJson(gj).add_to(fg)
    return fg


def _expose_heatmap(html: str) -> str:
    """Expose the HeatmapControl instance as `window.__heatmapCtrl`."""
    matches = list(re.finditer(r"([a-zA-Z0-9_$]+)\.addTo\(map\);", html))
    if matches:
        m = matches[-1]
        html = (
            html[: m.start()]
            + f"window.__heatmapCtrl = {m.group(1)};"
            + html[m.start() :]
        )
    return html


def _make_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    _polygon_layer().add_to(m)
    _points_group().add_to(m)
    LayerControl(position="topright").add_to(m)
    HeatmapControl(position="bottomleft").add_to(m)
    html = _expose_heatmap(m.get_root().render())
    return make_browser_page(browser, tmp_path, html, "picker_close")


# Capture console.warn during page setup to detect duplicate overlay ids.
_WARN_PRELUDE = """
  (() => {
    const _w = console.warn;
    window.__setupWarns = [];
    console.warn = (...a) => { window.__setupWarns.push(String(a[0])); _w(...a); };
  })();
"""


def _make_page_in_order(browser, tmp_path, layer_first: bool):
    """Build a page with LayerControl + HeatmapControl in a chosen order.

    Both controls share one map. Each registers a picker overlay entry on
    the shared per-map registry; the registration order decides which entry
    survives when both used the same id (the duplicate is rejected). This
    helper pins the order so the regression test can prove that the fix makes
    the outcome order-independent.
    """
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    _polygon_layer().add_to(m)
    _points_group().add_to(m)
    if layer_first:
        LayerControl(position="topright").add_to(m)
        HeatmapControl(position="bottomleft").add_to(m)
    else:
        HeatmapControl(position="bottomleft").add_to(m)
        LayerControl(position="topright").add_to(m)
    html = _expose_heatmap(m.get_root().render())
    return make_browser_page(
        browser, tmp_path, html, "picker_close", prelude=_WARN_PRELUDE
    )


def _state(page) -> dict:
    return page.evaluate(_js("common/read_picker_panel_state"))


def _wait_closed(page) -> None:
    page.wait_for_selector(
        ".foliplus-scheme-picker-portal", state="detached", timeout=3000
    )


def _centre(page, selector: str) -> dict:
    return page.evaluate(_js("common/read_element_centre"), selector)


def _open_heatmap_dropdown(page) -> None:
    expanded = page.evaluate(_js("HeatmapControl/panel_is_open"))
    if not expanded:
        page.evaluate(_js("HeatmapControl/click_toggle_button"))
        page.wait_for_selector(
            ".foliplus-heatmap-ctrl.foliplus-is-expanded",
            state="attached",
            timeout=5000,
        )
        heatmap_ready(page)
    page.wait_for_selector(
        ".foliplus-heatmap-scheme-bar", state="visible", timeout=5000
    )
    box = _centre(page, ".foliplus-heatmap-scheme-bar")
    page.mouse.click(box["x"], box["y"])
    page.wait_for_selector(
        ".foliplus-scheme-picker-portal", state="attached", timeout=3000
    )


def _open_style_dropdown(page) -> None:
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached", timeout=5000
    )
    panel_ready(page)
    opened = page.evaluate(_js("LayerControl/open_style_panel_polygon"))
    assert opened["ok"], f"style panel did not open: {opened}"
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible", timeout=5000)
    ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
    assert ready["ok"], f"the ramp arm did not settle: {ready}"
    page.mouse.click(ready["triggerX"], ready["triggerY"])
    page.wait_for_selector(
        ".foliplus-scheme-picker-portal", state="attached", timeout=3000
    )


class TestPickerCloseBrowser:
    """One rule for both consumers: put the panel away, the list goes with it."""

    def test_heatmap_affordances_close_the_list(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # The close button in the panel header.
            _open_heatmap_dropdown(page)
            page.evaluate(_js("HeatmapControl/click_close_button"))
            _wait_closed(page)
            state = _state(page)
            assert state["portalCount"] == 0, state
            assert state["heatmap"]["collapsed"], state

            # The clear button collapses the panel too, so it must close too.
            _open_heatmap_dropdown(page)
            page.evaluate(_js("HeatmapControl/click_clear_button"))
            _wait_closed(page)
            state = _state(page)
            assert state["portalCount"] == 0, state
            assert state["heatmap"]["collapsed"], state
            assert not errors, f"JS errors: {errors}"

    def test_heatmap_outside_press_closes_both(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _open_heatmap_dropdown(page)
            box = page.evaluate(_js("common/read_map_centre"))
            page.mouse.click(box["x"], box["y"])
            _wait_closed(page)
            state = _state(page)
            assert state["portalCount"] == 0, state
            assert state["heatmap"]["collapsed"], state
            assert not errors, f"JS errors: {errors}"

    def test_escape_closes_the_list_and_keeps_the_panel(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _open_heatmap_dropdown(page)
            page.keyboard.press("Escape")
            _wait_closed(page)
            state = _state(page)
            assert state["portalCount"] == 0, state
            assert state["heatmap"]["expanded"], state
            assert not errors, f"JS errors: {errors}"

    def test_collapse_in_pseudo_fullscreen_closes_the_list(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            entered = page.evaluate(_js("common/set_pseudo_fullscreen"), True)
            assert entered["ok"], entered
            assert entered["pseudo"], entered
            _open_heatmap_dropdown(page)
            hosted = _state(page)
            assert hosted["hostClass"].find("leaflet-container") >= 0, hosted

            page.evaluate(_js("HeatmapControl/click_close_button"))
            _wait_closed(page)
            state = _state(page)
            assert state["portalCount"] == 0, state
            page.evaluate(_js("common/set_pseudo_fullscreen"), False)
            assert not errors, f"JS errors: {errors}"

    def test_removing_the_control_closes_the_list(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _open_heatmap_dropdown(page)
            page.evaluate(_js("common/remove_heatmap_control"))
            _wait_closed(page)
            assert not page.evaluate(_js("common/has_heatmap_control"))
            assert not errors, f"JS errors: {errors}"

    def test_style_drawer_close_closes_the_list(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _open_style_dropdown(page)
            assert page.evaluate(_js("LayerControl/close_style_panel"))
            _wait_closed(page)
            state = _state(page)
            assert state["portalCount"] == 0, state
            assert not state["stylePanelOpen"], state
            assert not errors, f"JS errors: {errors}"

    def test_the_next_press_after_a_choice_still_lands(self, browser, tmp_path):
        """Choosing a scheme must not swallow the press that follows."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _open_heatmap_dropdown(page)
            rows = page.evaluate(_js("common/read_scheme_dropdown_rows"))
            assert rows["ok"], rows
            page.mouse.click(rows["targetX"], rows["targetY"])
            _wait_closed(page)
            state = _state(page)
            assert state["heatmap"]["expanded"], state

            toggle = _centre(page, ".foliplus-heatmap-ctrl .foliplus-toggle-btn")
            page.mouse.click(toggle["x"], toggle["y"])
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-collapsed",
                state="attached",
                timeout=3000,
            )
            assert not errors, f"JS errors: {errors}"

    def test_escape_in_style_drawer_ignores_a_second_picker_on_the_same_map(
        self, browser, tmp_path
    ):
        """One map, two picker-owning controls: Escape must close only the open list.

        Both LayerControl and HeatmapControl register a picker overlay entry on
        the shared per-map registry. Before the fix both used the same id, so the
        second registration was a duplicate and was rejected, leaving one control
        with no Escape-owning surface. With the style picker open, Escape must
        close the list and leave the style drawer in place — regardless of which
        control registered first. Both orders are exercised because the
        duplicate-winner depended on registration order.
        """
        for layer_first in (True, False):
            with use_page(
                lambda b, t: _make_page_in_order(b, t, layer_first), browser, tmp_path
            ) as (page, errors):
                # No duplicate overlay id may be logged during setup: the fix
                # namespaces the picker entry per consumer, so the two controls
                # never collide.
                _open_style_dropdown(page)
                page.keyboard.press("Escape")
                _wait_closed(page)
                state = _state(page)
                assert state["portalCount"] == 0, state
                assert state["stylePanelOpen"], state
                assert state["styleDrawerVisible"], state
                warns = page.evaluate("() => window.__setupWarns || []")
                dup = [w for w in warns if "duplicate overlay id" in w]
                assert not dup, (
                    f"duplicate overlay id warning (layer_first={layer_first}): {dup}"
                )
                assert not errors, f"JS errors (layer_first={layer_first}): {errors}"
