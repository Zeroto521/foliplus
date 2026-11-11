"""Browser tests for row-vs-map color fidelity (row author reads).

The row's author-color getters previously read the LIVE leaf icon after a
write (so a reset re-derived the user's paint) and walked only ONE level while
the capability gates walk the full tree. The fix routes both through the core's
captured-author table and the same walk primitive as the gate, so the row reads
what the map actually draws.

These tests assert the FIXED contract: the style row shows the author's real
paint — the derive path's inline style.color for a glyph, the nested chassis
preset for a group — and keeps a declared standard preset unchanged.
"""

from __future__ import annotations

import folium
from conftest import _js, use_page

from ._browser_base import LayerControlBrowserBase


class TestRowColorFidelity(LayerControlBrowserBase):
    """Row readings agree with the map's real paint."""

    @staticmethod
    def _icon_declared():
        fg = folium.FeatureGroup(name="Icon declared", overlay=True, show=True)
        folium.Marker(
            [26.08, 119.30],
            icon=folium.Icon(icon_color="red"),
            name="Declared icon color",
        ).add_to(fg)
        return fg

    @staticmethod
    def _icon_inline_only():
        """Author paints the glyph inline but declares no iconColor option."""
        fg = folium.FeatureGroup(name="Icon inline", overlay=True, show=True)
        folium.Marker(
            [26.08, 119.30],
            icon=folium.DivIcon(html='<i style="color:purple">&#9733;</i>'),
            name="Inline-only icon color",
        ).add_to(fg)
        return fg

    @staticmethod
    def _marker_color_declared():
        fg = folium.FeatureGroup(name="MC declared", overlay=True, show=True)
        folium.Marker(
            [26.08, 119.30],
            icon=folium.Icon(color="green"),
            name="Declared marker color",
        ).add_to(fg)
        return fg

    @staticmethod
    def _marker_color_nested() -> folium.FeatureGroup:
        """A nested group whose marker carries a chassis preset one level down."""
        inner = folium.FeatureGroup(name="Inner")
        folium.Marker(
            [26.08, 119.30],
            icon=folium.Icon(color="purple"),
            name="Nested marker",
        ).add_to(inner)
        outer = folium.FeatureGroup(name="Outer", overlay=True, show=True)
        outer.add_child(inner)
        return outer

    @staticmethod
    def _marker_color_mixed() -> folium.FeatureGroup:
        """Single-level mixed: first marker declares blue, second orange."""
        fg = folium.FeatureGroup(name="Mixed", overlay=True, show=True)
        folium.Marker(
            [26.08, 119.30],
            icon=folium.Icon(icon_color="white"),
            name="First",
        ).add_to(fg)
        folium.Marker(
            [26.08, 119.31],
            icon=folium.Icon(color="orange"),
            name="Second",
        ).add_to(fg)
        return fg

    def _measure(self, browser, tmp_path, layer, slug):
        with use_page(
            self._make_page, browser, tmp_path, layer, slug=slug
        ) as (page, errors):
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
        assert r["marker"] is not None and r["marker"]["innerColor"] == "rgb(255, 0, 0)", r
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
        assert r["marker"] is not None and r["marker"]["innerColor"] == "rgb(128, 0, 128)", r
        assert not errors, errors

    def test_marker_color_declared_matches(self, browser, tmp_path):
        """A declared chassis preset: the row shows it and the map paints it."""
        r, errors = self._measure(
            browser, tmp_path, self._marker_color_declared(), "fidelity_mc_declared"
        )
        assert r["panel"], r
        assert r["markerColorRow"]["present"], r
        assert r["markerColorRow"]["value"] == "green", r
        assert r["marker"] is not None and r["marker"]["hasChassis"], r
        assert "awesome-marker-icon-green" in r["marker"]["cls"], r
        assert not errors, errors

    def test_marker_color_nested_matches(self, browser, tmp_path):
        """A nested chassis preset: the row reads the full tree, like the gate."""
        r, errors = self._measure(
            browser, tmp_path, self._marker_color_nested(), "fidelity_mc_nested"
        )
        assert r["panel"], r
        assert r["markerColorRow"]["present"], r
        # The row must read the nested purple, not the blue fallback.
        assert r["markerColorRow"]["value"] == "purple", r
        # The map paints the nested marker's real chassis.
        assert r["marker"] is not None and r["marker"]["hasChassis"], r
        assert "awesome-marker-icon-purple" in r["marker"]["cls"], r
        assert not errors, errors

    def test_marker_color_mixed_first_wins(self, browser, tmp_path):
        """Single-level mixed: the row reads the first marker's declared preset."""
        r, errors = self._measure(
            browser, tmp_path, self._marker_color_mixed(), "fidelity_mc_mixed"
        )
        assert r["panel"], r
        assert r["markerColorRow"]["present"], r
        assert r["markerColorRow"]["value"] == "blue", r
        assert r["marker"] is not None and "awesome-marker-icon-blue" in r["marker"]["cls"], r
        assert not errors, errors
