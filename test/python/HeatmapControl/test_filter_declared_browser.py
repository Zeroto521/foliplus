"""Browser test: a declared heatmap filter is the view the page opens on.

The unit tests pin the seed; this drives a real page. The h3 stub puts every
point in one cell, so the aggregated cell value is the evidence: with
agg="sum" the declared range must leave only the kept points in the sum,
and a page without a declaration must sum all of them.
"""

from __future__ import annotations

import json

import folium
import pytest
from conftest import _js, heatmap_ready, make_browser_page, use_page

from .helper import _expose_ctrl, _stub_html

_READ = _js("HeatmapControl/read_declared_filter")

# One point layer, three points carrying val = 26.07 / 26.08 / 26.09.
_ALL = 26.07 + 26.08 + 26.09
_DECLARED = {"kind": "atom", "field": "val", "op": "between", "range": [26.075, 26.085]}
_KEPT = 26.08


def _make_page(browser, tmp_path, **ctrl_kwargs):
    """A page with one three-point layer and a HeatmapControl, expanded.

    The heatmap builds its DOM (and runs its first scan + render) on the
    first expand, so the probe expands the panel and waits for the ready
    signal before reading — the same "open the page" moment a user sees.
    """
    from foliplus import HeatmapControl, LayerControl

    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    fg = folium.FeatureGroup(name="Points", show=True)
    for lat in (26.07, 26.08, 26.09):
        gj = json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"val": lat},
                        "geometry": {"type": "Point", "coordinates": [119.30, lat]},
                    }
                ],
            }
        )
        folium.GeoJson(gj).add_to(fg)
    fg.add_to(m)

    LayerControl().add_to(m)
    HeatmapControl(**ctrl_kwargs).add_to(m)

    html = _expose_ctrl(_stub_html(m.get_root().render()))
    page, errors = make_browser_page(browser, tmp_path, html, "heatmap_filter")
    page.wait_for_selector(".foliplus-heatmap-ctrl", state="attached", timeout=10000)
    page.evaluate(_js("HeatmapControl/click_toggle_button"))
    page.wait_for_selector(
        ".foliplus-heatmap-ctrl.foliplus-is-expanded", state="attached", timeout=5000
    )
    heatmap_ready(page)
    page.wait_for_function(
        "() => window.__heatmapCtrl.mgr.cachedFeatures !== null", timeout=10000
    )
    return page, errors


class TestDeclaredHeatmapFilterBrowser:
    def test_declared_range_filters_the_first_render(self, browser, tmp_path):
        with use_page(
            _make_page,
            browser,
            tmp_path,
            agg="sum",
            field="val",
            filter={"field": "val", "between": [26.075, 26.085]},
        ) as (page, errors):
            state = page.evaluate(_READ)

            assert state["filter"] == _DECLARED, state
            # A declaration is not a user choice: the slot stays unowned.
            assert state["touched"] is False, state
            assert len(state["values"]) == 1, state
            assert state["values"][0] == pytest.approx(_KEPT), state
            assert not errors, f"JS errors: {errors}"

    def test_without_a_declaration_every_point_is_counted(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path, agg="sum", field="val") as (
            page,
            errors,
        ):
            state = page.evaluate(_READ)

            assert state["filter"] is None, state
            assert state["values"][0] == pytest.approx(_ALL), state
            assert not errors, f"JS errors: {errors}"

    def test_an_unusable_declaration_leaves_every_point_counted(
        self, browser, tmp_path
    ):
        # Outside the extent: the runtime clamps, and a clamp that equals the
        # full extent means "no filter" - never a filter that hides the data.
        with use_page(
            _make_page,
            browser,
            tmp_path,
            agg="sum",
            field="val",
            filter={"field": "val", "between": [1000, 2000]},
        ) as (page, errors):
            state = page.evaluate(_READ)

            assert state["filter"] is None, state
            assert state["values"][0] == pytest.approx(_ALL), state
            assert not errors, f"JS errors: {errors}"
