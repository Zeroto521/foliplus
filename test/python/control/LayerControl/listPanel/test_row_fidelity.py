"""Browser tests for row-vs-map color fidelity (row author reads).

The row's author-color getters previously read the LIVE leaf icon after a
write (so a reset re-derived the user's paint) and walked only ONE level while
the capability gates walk the full tree. The fix routes both through the core's
captured-author table and the same walk primitive as the gate, so the row reads
what the map actually draws.

These tests assert the FIXED contract: the style row shows the author's real
paint — the derive path's inline style.color for a glyph, the nested chassis
preset for a group — and keeps a declared standard preset unchanged.

The row is a GeoJson layer, not a FeatureGroup: a FeatureGroup is a container
row now (no style panel), and a bare folium.Marker is a MacroElement rather
than a Layer, so it never becomes a row on its own. A GeoJson layer with a
point feature and a `marker=` template is the leaf that carries an awesome
marker and still owns a style panel.
"""

from __future__ import annotations

import json

import folium
from conftest import _js, load_geojson, use_page

from ..helper_browser import LayerControlBrowserBase

_POINT = json.dumps(load_geojson("LayerControl", "point_11934_2611"))


def _marker_layer(name: str, marker: folium.Marker) -> folium.GeoJson:
    """A leaf GeoJson layer whose point renders as *marker*."""
    return folium.GeoJson(_POINT, name=name, marker=marker)


class TestRowColorFidelityBrowser(LayerControlBrowserBase):
    """Row readings agree with the map's real paint."""

    @staticmethod
    def _icon_declared():
        return _marker_layer(
            "Icon declared", folium.Marker(icon=folium.Icon(icon_color="red"))
        )

    @staticmethod
    def _icon_inline_only():
        """Author paints the glyph inline but declares no iconColor option."""
        return _marker_layer(
            "Icon inline",
            folium.Marker(
                icon=folium.DivIcon(html='<i style="color:purple">&#9733;</i>')
            ),
        )

    @staticmethod
    def _marker_color_declared():
        return _marker_layer(
            "MC declared", folium.Marker(icon=folium.Icon(color="green"))
        )

    def _measure(self, browser, tmp_path, layer, slug):
        with use_page(self._make_page, browser, tmp_path, layer, slug=slug) as (
            page,
            errors,
        ):
            self._open_style_ramp(page)
            result = page.evaluate(_js("LayerControl/row_color_fidelity"))
            return result, errors

    def test_icon_color_declared_matches(self, browser, tmp_path):
        """A declared icon color: the row shows it and the map paints it."""
        r, errors = self._measure(
            browser, tmp_path, self._icon_declared(), "fidelity_icon_declared"
        )
        assert r["panel"], r
        assert r["iconColorRow"]["present"], r
        # The row normalizes the author's "red" to the #rrggbb input holds.
        assert r["iconColorRow"]["value"].lower() == "#ff0000", r
        # The map paints the same red.
        assert (
            r["marker"] is not None and r["marker"]["innerColor"] == "rgb(255, 0, 0)"
        ), r
        assert not errors, errors

    def test_icon_color_inline_matches(self, browser, tmp_path):
        """An inline-only author paint: the row reads the map's purple, not white."""
        r, errors = self._measure(
            browser, tmp_path, self._icon_inline_only(), "fidelity_icon_inline"
        )
        assert r["panel"], r
        assert r["iconColorRow"]["present"], r
        # The row must show the author's inline paint (purple), not #ffffff.
        assert r["iconColorRow"]["value"].lower() == "#800080", r
        # The map paints the same purple.
        assert (
            r["marker"] is not None and r["marker"]["innerColor"] == "rgb(128, 0, 128)"
        ), r
        assert not errors, errors

    def test_marker_color_declared_matches(self, browser, tmp_path):
        """A declared chassis preset: the row shows it and the map paints it."""
        r, errors = self._measure(
            browser, tmp_path, self._marker_color_declared(), "fidelity_mc_declared"
        )
        assert r["panel"], r
        assert r["markerColorRow"]["present"], r
        assert r["markerColorRow"]["value"].lower() == "#72b026", {
            "rowValue": r["markerColorRow"]["value"],
            "preset": r["marker"]["preset"] if r["marker"] else None,
        }
        assert r["marker"] is not None and r["marker"]["hasChassis"], r
        assert "awesome-marker-icon-green" in r["marker"]["cls"], r
        assert not errors, errors

    # The nested-group and mixed-group chassis reads used to be asserted here
    # through a FeatureGroup row's style panel. A FeatureGroup is a container
    # row now and a container has no style panel, so the browser-level premise
    # is gone. The capability itself is unchanged and covered where it lives:
    # test/js/control/LayerControl/ui/style/markerColor.test.ts ("reads a nested
    # group like the gate, not one level") and iconColor.test.ts ("shows the
    # author's color for a nested group, like the gate").
