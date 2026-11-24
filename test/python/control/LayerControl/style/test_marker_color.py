"""Split of test_style.py by dimension."""

from __future__ import annotations

import base64
import copy
import json
import re
import time
from pathlib import Path

import folium
import pytest
from conftest import (
    _js,
    feature_collection,
    heatmap_ready,
    leaflet_path,
    load_geojson,
    make_browser_page,
    panel_ready,
    point_feature,
    render,
    snippet,
    use_page,
    use_raw_page,
)

from foliplus import HeatmapControl, LayerControl


def _method_labels() -> tuple[str, str]:
    """The method row label for each built-in language, read from the locale
    table (single source — never pin the string twice)."""
    base = Path(__file__).resolve().parents[5] / "foliplus" / "locale"
    en = json.loads((base / "common.en.json").read_text(encoding="utf-8"))
    zh = json.loads((base / "common.zh.json").read_text(encoding="utf-8"))
    return en["foliplus.classification_method"], zh["foliplus.classification_method"]


from ..helper import _expand_panel, _geo_zone, _tiny_png, _write_html
from ..helper_browser import LayerControlBrowserBase


class TestStyleBrowser(LayerControlBrowserBase):
    def test_marker_color_keeps_chassis_container(self, browser, tmp_path):
        """P1: picking a marker color must not leave the marker as glyph-only.

        The reported regression: after choosing a chassis color, the marker's
        pin (the awesome-markers sprite container) disappears and only the
        glyph <i> remains. The row is now [color swatch | opacity number]; the
        chassis write drives the real Leaflet runtime, so the marker element
        must still carry the `awesome-marker-icon-<color>` chassis class and a
        non-empty background after the write, and Reset must restore the
        author icon.
        """
        fg = folium.GeoJson(
            json.dumps(feature_collection(point_feature(119.30, 26.08))),
            name="Points",
            overlay=True,
            show=True,
            marker=folium.Marker([26.08, 119.30], icon=folium.Icon(color="red")),
        )

        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="marker_color_chassis",
        ) as (page, errors):
            self._open_style_ramp(page)
            # before: author chassis + glyph DOM
            before = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#38aadd", "opacity": 100},
            )
            assert before["ok"], before
            assert before["marker"]["hasChassisClass"], (
                f"author marker has no chassis class: {before}"
            )
            page.screenshot(
                path=str(tmp_path / "marker_color_before.png"), full_page=True
            )

            # write the preset blue at alpha 100 through the swatch row
            written = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#38aadd", "opacity": 100},
            )
            assert written["ok"], written
            page.screenshot(
                path=str(tmp_path / "marker_color_after.png"), full_page=True
            )
            assert written["marker"] is not None, (
                f"marker element missing after the write: {written}"
            )
            # The chassis container must survive: the sprite class + a real
            # background image, and the glyph must still be painted.
            assert written["marker"]["hasChassisClass"], (
                f"marker lost its chassis container after the write: {written}"
            )
            assert "awesome-marker-icon-blue" in written["marker"]["cls"], (
                f"chassis color did not re-derive: {written}"
            )
            assert written["marker"]["hasSpan"] is False, (
                f"preset alpha 100 must NOT take a chassis span: {written}"
            )
            # The glyph must survive the write. When the author's glyph name
            # is not a FontAwesome 6 name (here: the bootstrap glyphicon
            # info-sign), the honest degradation keeps the author's inner
            # glyph verbatim — the chassis changes, the symbol does not.
            glyph_cls = (written["glyph"] or {}).get("cls") or ""
            assert written["glyph"], f"glyph missing after the write: {written}"
            assert (
                "foliplus-marker-glyph" in glyph_cls.split() or "glyphicon" in glyph_cls
            ), f"glyph not painted after the write: {written}"

    def test_icon_color_incremental_paint(self, browser, tmp_path):
        """The icon colour write paints the mounted glyph in place.

        A pure colour/opacity write must NOT rebuild the icon: the derived
        marker's inner <i> is the SAME element reference after the colour
        write (no DOM churn), its computed colour updates, and the marker's
        setIcon is called once for the glyph write and ZERO additional times
        for the colour write. A glyph write still rebuilds (one setIcon).
        """
        fg = folium.GeoJson(
            json.dumps(feature_collection(point_feature(119.30, 26.08))),
            name="Points",
            overlay=True,
            show=True,
            marker=folium.Marker([26.08, 119.30], icon=folium.Icon(color="red")),
        )

        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="icon_color_incremental",
        ) as (page, errors):
            self._open_style_ramp(page)
            marker_var = page.evaluate(_js("LayerControl/find_marker_var"))
            assert marker_var is not None, "could not find the folium marker var"
            page.evaluate(_js("LayerControl/set_test_marker"), marker_var)

            result = page.evaluate(_js("LayerControl/icon_incremental_probe"), {})
            assert result["ok"], result
            # The colour write must be incremental: same <i>, no rebuild.
            assert result["sameElementAfterColor"] is True, (
                f"colour write rebuilt the icon (element changed): {result}"
            )
            assert result["afterColor"]["color"] == "rgb(0, 255, 0)", (
                f"colour write did not paint the glyph: {result}"
            )
            assert result["setIconDeltaColor"] == 0, (
                f"colour write must not call setIcon: {result}"
            )
            # The glyph write must rebuild exactly once.
            assert result["callsAfterGlyph"] >= 1, f"glyph write must rebuild: {result}"
            assert (
                result["afterGlyph"]
                and "foliplus-marker-glyph" in result["afterGlyph"]["cls"].split()
            ), f"glyph not painted: {result}"

    def test_marker_color_custom_chassis_paint(self, browser, tmp_path):
        """The marker chassis accepts a custom hex + opacity.

        The row is [color swatch | opacity number]. Three paint paths:
          • preset hex at alpha 100  → library sprite class, NO chassis span
            (author-identical, acceptance ③);
          • preset hex at alpha <100 → chassis <span> carries the sprite with
            its own opacity, the glyph <i> is a sibling and stays opaque
            (acceptance ①);
          • custom hex (any alpha)    → chassis <span> carries a mask (same
            sprite as mask-image) + flat background-color, glyph opaque
            (acceptance ②).
        """
        fg = folium.GeoJson(
            json.dumps(feature_collection(point_feature(119.30, 26.08))),
            name="Points",
            overlay=True,
            show=True,
            marker=folium.Marker([26.08, 119.30], icon=folium.Icon(color="red")),
        )

        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="marker_color_custom",
        ) as (page, errors):
            self._open_style_ramp(page)

            # ③ preset hex at alpha 100 → sprite class, NO span.
            preset = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#38aadd", "opacity": 100},
            )
            assert preset["ok"], preset
            assert preset["marker"]["hasChassisClass"], (
                f"preset alpha 100 lost the sprite class: {preset}"
            )
            assert "awesome-marker-icon-blue" in preset["marker"]["cls"], (
                f"preset alpha 100 did not re-derive blue: {preset}"
            )
            assert preset["marker"]["hasSpan"] is False, (
                f"preset alpha 100 must NOT take a chassis span: {preset}"
            )
            assert preset["glyph"] and preset["glyph"]["opacity"] == "1", (
                f"preset alpha 100 glyph not opaque: {preset}"
            )

            # ① preset hex at alpha 50 → chassis span + sprite + opacity 0.5.
            half = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#38aadd", "opacity": 50},
            )
            assert half["ok"], half
            assert half["marker"]["hasSpan"] is True, (
                f"preset alpha 50 must use a chassis span: {half}"
            )
            assert (
                half["span"] is not None and "url(" in half["span"]["backgroundImage"]
            ), f"preset alpha 50 span lost the sprite: {half}"
            assert half["span"]["opacity"] == "0.5", (
                f"preset alpha 50 span opacity: {half}"
            )
            assert half["marker"]["containerBackgroundImage"] == "none", (
                f"preset alpha 50 container must clear the sprite: {half}"
            )
            assert half["glyph"] and half["glyph"]["opacity"] == "1", (
                f"preset alpha 50 glyph must stay opaque: {half}"
            )

            # ② custom hex at alpha 50 → chassis span + mask + flat bg-color.
            custom = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#ff9900", "opacity": 50},
            )
            assert custom["ok"], custom
            assert custom["marker"]["hasSpan"] is True, (
                f"custom hex must use a chassis span: {custom}"
            )
            assert (
                custom["span"] is not None and "url(" in custom["span"]["maskImage"]
            ), f"custom hex span lost the mask: {custom}"
            assert custom["span"]["backgroundColor"] == "rgb(255, 153, 0)", (
                f"custom hex span flat color: {custom}"
            )
            assert custom["span"]["opacity"] == "0.5", (
                f"custom hex span opacity: {custom}"
            )
            assert custom["glyph"] and custom["glyph"]["opacity"] == "1", (
                f"custom hex glyph must stay opaque: {custom}"
            )
