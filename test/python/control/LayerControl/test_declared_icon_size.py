"""Browser tests for the foliplus icon_size declaration channel.

A declared icon_size rides the same foliplus namespace as every other
per-layer declaration. folium's renderer camelizes every option key at
render time, so the namespace that reaches the browser spells it iconSize -
a reader that only looks up icon_size reads nothing on a rendered map and
the whole channel is dead. A rendered map is the only place that shows,
which is why these tests exist.

The declaration rides the layer. The reader reads it off the layer that owns
the leaves, so a GeoJson carries it where the reader looks (its options
slot); a FeatureGroup would not, because folium renders its options dict
into Leaflet featureGroup layers slot (the first argument) and the
declaration never reaches options at all.

The default (div-icon) path is verified end to end: the declared page draws
the marker bigger than an undeclared twin built from the same fixture, a
relative assertion so no path-specific base size is ever hard-coded. The
awesome-markers sprite path cannot be verified yet: #1216 scales it with a
transform that Leaflet overwrites when it positions the marker after a
setIcon, so a real browser never draws it larger - that defect is tracked
separately (behind #1228) and this test stays honest about it.
"""

from __future__ import annotations

import json

import folium
from conftest import _js, use_page

from ._browser_base import LayerControlBrowserBase

GLYPH = "map-pin"
COORDS = [119.30, 26.08]


def _points():
    """One point feature - the same data under both fixtures."""
    return json.dumps({
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature", "properties": {},
            "geometry": {"type": "Point", "coordinates": COORDS},
        }],
    })


class TestDeclaredIconSizeBrowser(LayerControlBrowserBase):
    """The declared icon_size must reach the rendered marker."""

    @staticmethod
    def _pick_glyph(page):
        """Write one glyph - the write path that consumes the declared size."""
        result = page.evaluate(_js("LayerControl/declared_icon_size_probe"), [GLYPH])
        assert result["cellFound"], f"no glyph cell: {result}"
        return result

    @staticmethod
    def _assert_scaled(declared, undeclared):
        """The declared marker is drawn wider than the undeclared one.

        Relative, so it holds for the default div-icon path and cannot pass
        by a hard-coded size.
        """
        d = declared["after"][0]
        u = undeclared["after"][0]
        assert u["box"][0] > 0, f"undeclared marker not drawn: {undeclared}"
        assert d["box"][0] > u["box"][0], (
            "the declared size had no effect - not drawn larger: declared "
            f"{d} vs undeclared {u}"
        )

    def test_declared_icon_size_scales_the_default_marker(self, browser, tmp_path):
        """A default (no author icon) marker scales up by the declared size.

        folium camelizes the declaration on render, so the reader must
        accept the iconSize spelling - without that the declared page
        renders exactly like the undeclared page and this fails.
        """
        with use_page(self._make_page, browser, tmp_path, _fixture(True), slug="d") as (page, _):
            self._open_style_ramp(page)
            declared = self._pick_glyph(page)
        with use_page(self._make_page, browser, tmp_path, _fixture(False), slug="u") as (page, _):
            self._open_style_ramp(page)
            undeclared = self._pick_glyph(page)
        self._assert_scaled(declared, undeclared)


def _fixture(declared=True):
    """A point layer with no author icon - the default div-icon path."""
    return folium.GeoJson(
        _points(), name="Points", foliplus={"icon_size": 50} if declared else {},
    )
