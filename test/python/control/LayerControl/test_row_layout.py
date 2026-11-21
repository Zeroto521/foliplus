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
from conftest import _js, snippet

from ._browser_base import LayerControlBrowserBase

_GEOMETRY = _js("RowLayout/read_row_layout_geometry")

_OPEN_FILTER_DROPDOWN = snippet("RowLayout/open_filter_dropdown")


class TestRowLayoutPrimitiveBrowser(LayerControlBrowserBase):
    """The dropdown option row is the row primitive by construction."""

    def test_option_row_matches_the_primitive(self, browser, tmp_path):
        fg = folium.FeatureGroup(name="Row primitive", overlay=True, show=True)
        folium.GeoJson(
            {
                "type": "Feature",
                "properties": {"name": "demo", "kind": "point"},
                "geometry": {"type": "Point", "coordinates": [119.30, 26.08]},
            },
            name="Geo demo",
        ).add_to(fg)
        page, errors = self._make_page(browser, tmp_path, fg)
        try:
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
