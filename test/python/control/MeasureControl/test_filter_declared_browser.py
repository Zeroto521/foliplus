"""Browser test: a declared measure filter is the view the page opens on.

The unit tests pin the seed; this drives a real page. Four measurements are
drawn (one per type) on a page whose MeasureControl declares a type filter:
the panel state, the kept count and the rendered leaves must all describe the
declared subset from the first render, with no user action.
"""

from __future__ import annotations

import re

import folium
from conftest import _js, make_browser_page, use_page

from .helper import _TURF_STUB, _stub_cdn

_DRAW_ALL = _js("MeasureControl/draw_all")
_READ_STATE = _js("MeasureControl/read_state")

_DECLARED = {
    "kind": "enum",
    "field": "type",
    "values": ["distance", "polygon"],
}


def _make_page(browser, tmp_path, **ctrl_kwargs):
    """A MeasureControl page with the test hooks the snippets read back.

    Mirrors ``helper._make_page`` (the manager is created lazily during
    addTo, so the hooks are injected into the rendered script) but forwards
    control kwargs, which the shared helper does not.
    """
    from foliplus import LayerControl, MeasureControl

    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    LayerControl().add_to(m)
    MeasureControl(**ctrl_kwargs).add_to(m)

    html = m.get_root().render()
    html, n = re.subn(
        r"(new MeasureControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
        r"window.__measureCtrl = \1 "
        r"window.__measureManager = window.__measureCtrl.mgr; "
        r"window.__map = map; "
        r"window.__measureStorageKey = STORAGE.KEY;",
        html,
        count=1,
    )
    assert n == 1, "MeasureControl instantiation not found in rendered HTML"
    html = _stub_cdn(html, {"turf": _TURF_STUB})
    page, errors = make_browser_page(browser, tmp_path, html, "measure_filter")
    page.wait_for_selector(".foliplus-measure-ctrl", state="attached", timeout=10000)
    return page, errors


def _draw_and_read(page):
    page.evaluate(_DRAW_ALL)
    page.wait_for_timeout(600)
    return page.evaluate(_READ_STATE)


class TestDeclaredMeasureFilterBrowser:
    def test_declared_types_are_the_first_render(self, browser, tmp_path):
        with use_page(
            _make_page,
            browser,
            tmp_path,
            filter=["distance", "polygon"],
        ) as (page, errors):
            state = _draw_and_read(page)

            assert sorted(state["stored"]) == [
                "circle",
                "distance",
                "marker",
                "polygon",
            ], state
            assert state["filter"] == _DECLARED, state
            assert state["visible"] == ["distance", "polygon"], state
            # The row count and the rendered leaves describe the same kept set.
            assert state["count"] == "2", state
            assert state["paths"] == 2, state
            assert not errors, f"JS errors: {errors}"

    def test_without_a_declaration_every_measurement_is_visible(
        self, browser, tmp_path
    ):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            state = _draw_and_read(page)

            assert state["filter"] is None, state
            assert sorted(state["visible"]) == [
                "circle",
                "distance",
                "marker",
                "polygon",
            ], state
            assert state["count"] == "4", state
            assert not errors, f"JS errors: {errors}"

    def test_an_unknown_declared_type_does_not_hide_everything(self, browser, tmp_path):
        # The runtime owns the type domain: a name it does not know is dropped,
        # and a declaration that keeps nothing reads as "no filter".
        with use_page(
            _make_page,
            browser,
            tmp_path,
            filter=["bogus"],
        ) as (page, errors):
            state = _draw_and_read(page)

            assert state["filter"] is None, state
            assert len(state["visible"]) == 4, state
            assert not errors, f"JS errors: {errors}"
