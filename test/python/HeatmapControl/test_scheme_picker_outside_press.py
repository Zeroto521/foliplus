"""A press on a collapsed Leaflet control still dismisses an open scheme list.

Regression guard for #833. The heatmap scheme list portals outside the panel,
and a LayerControl toggle (a real Leaflet control) calls L.DomEvent.stop in its
own click handler, so the event never reaches a document *bubble* listener.
Only the registry's capture-phase click listener can observe it and dismiss the
dropdown. This drives the real affordance: open the heatmap colour list, press
the collapsed LayerControl control, and assert the list closes.

Unit tests model the registry in isolation; this exercises the actual Leaflet
control toggle so the capture-phase path is covered end to end.
"""

from __future__ import annotations

import json

import folium
from conftest import _js, heatmap_ready, make_browser_page, use_page

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


def _centre(page, selector: str) -> dict:
    return page.evaluate(_js("common/read_element_centre"), selector)


def _make_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    _polygon_layer().add_to(m)
    _points_group().add_to(m)
    LayerControl(position="topright").add_to(m)
    HeatmapControl(position="bottomleft").add_to(m)
    html = m.get_root().render()
    return make_browser_page(browser, tmp_path, html, "picker_outside_press")


class TestSchemePickerOutsidePressBrowser:
    def test_press_on_collapsed_layer_control_closes_the_list(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # Expand the heatmap panel and open its colour scheme list.
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl", state="attached", timeout=10000
            )
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

            # Press the collapsed LayerControl control. Its own toggle calls
            # L.DomEvent.stop, so only the capture-phase document listener can
            # see the press and dismiss the dropdown.
            state = page.evaluate(_js("common/read_picker_panel_state"))
            assert state["layer"]["collapsed"], state

            clicked = page.evaluate(_js("LayerControl/click_collapsed_layer_toggle"))
            assert clicked["clicked"], clicked
            assert clicked["nowExpanded"], clicked

            # The list must close even though the press was stopped at the control.
            page.wait_for_selector(
                ".foliplus-scheme-picker-portal", state="detached", timeout=3000
            )
            after = page.evaluate(_js("common/read_picker_panel_state"))
            assert after["open"] is False, after
            assert after["heatmap"]["expanded"], after
            assert not errors, f"JS errors: {errors}"
