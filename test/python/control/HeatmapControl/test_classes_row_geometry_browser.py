"""Heatmap Method + Classes row geometry (browser probe).

The Method + Classes row shares the LayerControl by-value row's shape: the
Method dropdown flexes to fill the shared control column and the class-count
dropdown takes the compact secondary width, so the two panels read alike.
The geometry needs a real browser (jsdom has no layout, no stacking order);
the stylesheet contract is asserted in vitest
(test/js/control/HeatmapControl/classesRowWidth.test.ts) and the rendered
pixels are recorded here.
"""

from __future__ import annotations

import json

import folium
from conftest import _js, make_browser_page, snippet, use_page

from foliplus import HeatmapControl, LayerControl


def _make_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    for i, (lat, lng) in enumerate([(26.08, 119.30), (26.09, 119.31), (26.07, 119.29)]):
        fg = folium.FeatureGroup(name=f"Points {i}", show=True)
        features = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"val": lat},
                    "geometry": {"type": "Point", "coordinates": [lng, lat]},
                }
            ],
        }
        folium.GeoJson(json.dumps(features)).add_to(fg)
        fg.add_to(m)
    LayerControl().add_to(m)
    HeatmapControl().add_to(m)
    html = m.get_root().render()
    return make_browser_page(
        browser,
        tmp_path,
        html,
        "heatmap_classes_row_geometry",
    )


class TestClassesRowGeometryBrowser:
    """The Method dropdown fills the control column, the class-count dropdown
    takes the compact secondary width, and the two do not overlap."""

    def test_classes_row_geometry(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded", state="attached"
            )
            # Pick a point layer and settle the aggregation so the Method /
            # Classes row is laid out (the rows are hidden until a layer is
            # selected). Same setup as the dropdown-panel browser test.
            page.evaluate(snippet("HeatmapControl/panel_ready_watch"))
            page.wait_for_timeout(400)
            page.evaluate(snippet("HeatmapControl/panel_set_agg_sum"))
            page.wait_for_timeout(400)
            # The wrappers only get a non-zero box once the panel settles;
            # wait for the method wrapper to be laid out before measuring, so
            # the probe reads a visible element rather than a 0-width stub.
            page.wait_for_function(
                """() => {
                    const method = document.querySelector(
                        ".foliplus-heatmap-ctrl .foliplus-dropdown.foliplus-heatmap-method",
                    );
                    return !!method && method.offsetWidth > 0 && method.offsetHeight > 0;
                }"""
            )
            data = page.evaluate(_js("HeatmapControl/read_classes_row_geometry"))
            assert data["ok"], data
            # The probe must have measured laid-out wrappers; a 0-width
            # measurement would make the geometry relationships trivially true.
            assert data["widthsPositive"], data
            assert data["methodFillsControl"], data
            assert data["classesAtSecondary"], data
            assert data["noOverlap"], data
            assert not errors, f"JS errors: {errors}"
