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
_PICK = _js("HeatmapControl/pick_layer")

# One point layer, three points carrying val = 26.07 / 26.08 / 26.09.
_ALL = 26.07 + 26.08 + 26.09
_DECLARED = {"kind": "atom", "field": "val", "op": "between", "range": [26.075, 26.085]}
_KEPT = 26.08


def _open_panel(page):
    """Expand the panel and wait for the control's first scan.

    The heatmap's DOM (and its first scan + render) is built when the control
    is added to the map; expanding only makes the panel visible, so the probe
    expands it first and reads the same "open page" state a user sees.
    """
    page.wait_for_selector(".foliplus-heatmap-ctrl", state="attached", timeout=10000)
    page.evaluate(_js("HeatmapControl/click_toggle_button"))
    page.wait_for_selector(
        ".foliplus-heatmap-ctrl.foliplus-is-expanded", state="attached", timeout=5000
    )
    heatmap_ready(page)


def _wait_for_frame(page):
    page.wait_for_function(
        "() => window.__heatmapCtrl.mgr.cachedFeatures !== null", timeout=10000
    )


def _make_page(
    browser,
    tmp_path,
    *,
    layers=(("Points", (26.07, 26.08, 26.09)),),
    wait_for_render=True,
    **ctrl_kwargs,
):
    """A page with the given point layers and a HeatmapControl, expanded.

    wait_for_render waits for the first aggregated frame; a page with more than
    one source has nothing selected yet, so the probe waits for the pick.
    """
    from foliplus import HeatmapControl, LayerControl

    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    for name, lats in layers:
        fg = folium.FeatureGroup(name=name, show=True)
        for lat in lats:
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
    _open_panel(page)
    if wait_for_render:
        _wait_for_frame(page)
    return page, errors


def _make_two_layer_page(browser, tmp_path, **ctrl_kwargs):
    """Two point layers and no declared starting layer: the source is picked by
    hand, which is the path the dropdown's onchange owns."""
    return _make_page(
        browser,
        tmp_path,
        layers=(("Alpha", (26.07,)), ("Beta", (26.07, 26.08, 26.09))),
        wait_for_render=False,
        **ctrl_kwargs,
    )


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

    def test_picking_a_source_by_hand_filters_the_first_frame(self, browser, tmp_path):
        """The declaration covers a source the user picks, not only the declared
        / auto-selected / restored ones: the first frame after the pick is
        filtered, and a reload agrees with it."""
        with use_page(
            _make_two_layer_page,
            browser,
            tmp_path,
            agg="sum",
            field="val",
            filter={"field": "val", "between": [26.075, 26.085]},
        ) as (page, errors):
            picked = page.evaluate(_PICK, "Beta")
            assert picked["ok"], picked
            _wait_for_frame(page)
            state = page.evaluate(_READ)

            assert state["filter"] == _DECLARED, state
            assert state["touched"] is False, state
            assert len(state["values"]) == 1, state
            assert state["values"][0] == pytest.approx(_KEPT), state

            # The restored record must reproduce the first frame. A seed that
            # only ran on reload would disagree here.
            page.reload()
            _open_panel(page)
            _wait_for_frame(page)
            reloaded = page.evaluate(_READ)

            assert reloaded["filter"] == state["filter"], (state, reloaded)
            assert reloaded["values"] == state["values"], (state, reloaded)
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
        # Outside the extent: the seed reports it and starts unfiltered —
        # clamping would collapse it onto one bound and hide the data, and
        # "declared" must never mean "filtered to empty".
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
