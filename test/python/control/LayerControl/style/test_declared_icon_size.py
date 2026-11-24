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

Both paths are verified end to end, each against an undeclared twin built
from the same fixture so no path-specific base size is ever hard-coded: the
default (div-icon) path draws the marker bigger, and the awesome-markers
sprite path (an author icon) draws the sprite chassis bigger. The sprite path
scales via an INNER wrapper (the outer div's transform is owned by Leaflet's
positioning, so a scale there would be overwritten after setIcon) with the
outer box sized to the scaled iconSize/anchor - the drawn width must equal the
declared width, an absolute assertion that pins the fix (a regression that
reverts to a transform on the outer div, or re-hardcodes the base width,
turns it red).
"""

from __future__ import annotations

import json

import folium
from conftest import _js, load_geojson, use_page

from ..helper_browser import LayerControlBrowserBase

GLYPH = "map-pin"


def _points():
    """One point feature - the same data under both fixtures."""
    return json.dumps(load_geojson("LayerControl", "icon_size_point"))


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
        with use_page(self._make_page, browser, tmp_path, _fixture(True), slug="d") as (
            page,
            _,
        ):
            self._open_style_ramp(page)
            declared = self._pick_glyph(page)
        with use_page(
            self._make_page, browser, tmp_path, _fixture(False), slug="u"
        ) as (page, _):
            self._open_style_ramp(page)
            undeclared = self._pick_glyph(page)
        self._assert_scaled(declared, undeclared)

    def test_declared_icon_size_scales_the_sprite_marker(self, browser, tmp_path):
        """An author (awesome-markers sprite) marker scales to the declared width.

        The sprite path is the one #1216 could not verify: the old code put
        the scale on the marker's own transform, which Leaflet overwrites when
        it positions the marker after setIcon, so the sprite never drew
        larger. The fix moves the scale to an inner wrapper and sizes the
        outer box to the scaled iconSize/anchor, so a real browser draws the
        chassis at exactly the declared width. An absolute assertion (== 50)
        pins the fix: a regression to a marker-transform scale, or to a
        hard-coded 25px base, renders a different width and turns this red.
        """
        declared_width = 50
        with use_page(
            self._make_page, browser, tmp_path, _sprite_fixture(True), slug="sd"
        ) as (page, _):
            self._open_style_ramp(page)
            declared = self._pick_glyph(page)
        with use_page(
            self._make_page, browser, tmp_path, _sprite_fixture(False), slug="su"
        ) as (page, _):
            self._open_style_ramp(page)
            undeclared = self._pick_glyph(page)
        # The declared sprite chassis draws at the declared width (absolute).
        d = declared["after"][0]
        assert d["box"][0] == declared_width, (
            "the declared sprite did not draw at the declared width: "
            f"{d['box']} vs expected {declared_width}"
        )
        # And strictly wider than the undeclared twin (the author's 35px base).
        u = undeclared["after"][0]
        assert u["box"][0] > 0, f"undeclared sprite not drawn: {undeclared}"
        assert d["box"][0] > u["box"][0], (
            "the declared sprite was not drawn larger than the undeclared "
            f"twin: declared {d['box']} vs undeclared {u['box']}"
        )


def _fixture(declared=True):
    """A point layer with no author icon - the default div-icon path."""
    return folium.GeoJson(
        _points(),
        name="Points",
        foliplus={"icon_size": 50} if declared else {},
    )


def _sprite_fixture(declared=True):
    """A point layer with an awesome-markers author icon (the sprite path).

    The author's icon is a folium.Icon(color="blue"), which renders an
    L.AwesomeMarkers icon (35x45 / [17,42]) - the path the declared size
    must scale via the inner wrapper. The undeclared twin renders the
    author's natural 35px chassis.
    """
    return folium.GeoJson(
        _points(),
        name="Points",
        marker=folium.Marker(icon=folium.Icon(color="blue")),
        foliplus={"icon_size": 50} if declared else {},
    )
