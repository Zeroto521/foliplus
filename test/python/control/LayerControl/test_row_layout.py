"""Browser guard for the shared row primitive (row-primitive PR).

The dropdown option row must adopt the shared row primitive
(.foliplus-row) so its geometry (height / padding-left / gap / font-size /
border-left-width) equals the primitive's own, and its content cell (the
label) lands on the same x as the primitive's content cell. This is the
computed-style parity jsdom cannot assert (no flex layout there).

The probe reads a real dropdown option (inside the LayerControl filter
panel) and a reference .foliplus-row built by ui/rowLayout.ts.
"""

from __future__ import annotations

import folium
from conftest import _js, load_geojson, panel_ready, snippet

from ._browser_base import LayerControlBrowserBase
from .helper import _geo_mixed

_geo_point = load_geojson("LayerControl", "point_pair_offset")

_GEOMETRY = _js("RowLayout/read_row_layout_geometry")

_OPEN_FILTER_DROPDOWN = snippet("RowLayout/open_filter_dropdown")


class TestRowLayoutPrimitiveBrowser(LayerControlBrowserBase):
    """The dropdown option row is the row primitive by construction."""

    def test_option_row_matches_the_primitive(self, browser, tmp_path):
        fg = folium.FeatureGroup(name="Row primitive", overlay=True, show=True)
        folium.GeoJson(_geo_point, name="Geo demo").add_to(fg)
        page, errors = self._make_page(browser, tmp_path, fg)
        try:
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            assert page.evaluate(_OPEN_FILTER_DROPDOWN), (
                "the filter panel dropdown did not open"
            )
            got = page.evaluate(_GEOMETRY)
            assert got.get("present"), got
            assert got["optionHeight"] == got["refHeight"], got
            for prop in ("padding-left", "gap", "font-size", "border-left-width"):
                assert got["optionVals"][prop] == got["refVals"][prop], (
                    prop,
                    got["optionVals"][prop],
                    got["refVals"][prop],
                )
            assert abs(got["optionContentX"] - got["refContentX"]) < 0.5, got
        finally:
            page.close()


_ELLIPSIS = _js("RowLayout/read_option_label_ellipsis")


class TestRowLayoutEllipsisBrowser(LayerControlBrowserBase):
    """A long option label ellipsizes instead of overflowing the popup (P2-1).

    After the option row migrated into the shared row primitive, the label
    became a child of .foliplus-row-content (not a flex item of the option
    button). An inline element's overflow:hidden is ignored, so the label's
    text-overflow:ellipsis was dead code and a long label overflowed the
    popup. The fix makes .foliplus-row-content a flex container
    (display:flex; align-items:center; overflow:hidden), which blockifies the
    label back into a flex item with a definite width, so its own
    overflow:hidden + text-overflow:ellipsis recipe applies and the ellipsis
    condition (scrollWidth > clientWidth) is established.
    """

    def test_option_label_ellipsizes(self, browser, tmp_path):
        fg = folium.FeatureGroup(name="Row ellipsis", overlay=True, show=True)
        folium.GeoJson(_geo_mixed, name="Geo demo").add_to(fg)
        page, errors = self._make_page(browser, tmp_path, fg)
        try:
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            got = page.evaluate(_ELLIPSIS)
            assert got is not None, "the ellipsis probe did not run"
            assert got.get("ok"), got
            # The label is clipped by the content cell: overflow establishes
            # the ellipsis condition, so a long label reports content that
            # overflows its box (scrollWidth > clientWidth).
            assert got["overflows"], got
            assert got["labelDisplay"] == "block", got
            assert got["contentOverflow"] == "hidden", got
            # The clipped label never escapes the option button.
            assert got["labelInsideRow"] is True, got
        finally:
            page.close()
