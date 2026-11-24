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
from ..helper import _expand_panel, _geo_zone, _tiny_png, _write_html
from ..helper_browser import LayerControlBrowserBase

class TestStyleBrowser(LayerControlBrowserBase):
    def test_border_original_roundtrip_restores_computed_style(self, browser, tmp_path):
        """A solid → ORIGINAL round trip repaints the author's stroke.

        The restore path is the point, not the switch over: after the user
        writes a colour and width in solid mode and returns to ORIGINAL, the
        panel must show the author's colour (read-only) and the map must paint
        it. Asserted on getComputedStyle — what the browser actually paints —
        never on DOM attributes or source strings.

        A width the user chose rides both modes, so it stays after the return
        (the weight slot stays editable in ORIGINAL). The author's colour must
        come back even though the user's colour is still stored for the next
        solid visit.

        The read-only guard is the negative case: if ORIGINAL ever lets the
        user edit the colour again (colour intent wins over author stroke),
        the swatch stops being disabled and this test fails.
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        # A numeric property is what earns the border mode select (original /
        # solid / value); without it the row renders a bare solid swatch and
        # there is no mode to switch back from. The style_function carries the
        # authored stroke so ORIGINAL has an author colour to restore. A plain
        # GeoJson data layer is the proven _ramp_layer() pattern that also
        # produces a panel row.
        border_data = copy.deepcopy(load_geojson("common", "polygons_fuzhou_3offset"))
        folium.GeoJson(
            json.dumps(border_data),
            style_function=lambda _f: {"color": "#0000ff", "weight": 2},
            name="Polygon data",
        ).add_to(m)
        LayerControl(locale="en").add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_border_original_roundtrip.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            # Author baseline: original mode, read-only swatch showing the
            # author's colour, map painting it.
            baseline = page.evaluate(
                _js("LayerControl/border_original_roundtrip"),
                ["Polygon data"],
            )
            assert baseline.get("row"), f"layer row not found: {baseline}"
            assert baseline["mode"] == "original", baseline
            assert baseline["colorInput"]["readOnly"] is True, baseline
            assert baseline["colorInput"]["disabled"] is True, baseline
            # The border swatch is a read-only control (PANEL_CLASS.READONLY),
            # so it carries the shared contract: cursor default, focus() inert.
            assert baseline["colorInput"]["cursor"] == "default", baseline
            assert baseline["colorInput"]["focusLanded"] is False, baseline
            for stroke in baseline["strokes"]:
                assert stroke["stroke"] == "rgb(0, 0, 255)", (
                    f"author stroke not painted at baseline: {baseline}"
                )
                assert stroke["strokeWidth"] == "2px", (
                    f"author width not painted at baseline: {baseline}"
                )

            # Solid: write a user colour and width.
            solid = page.evaluate(
                _js("LayerControl/border_original_roundtrip"),
                ["Polygon data", "solid", "#ff0000", 6],
            )
            assert solid["mode"] == "solid", solid
            assert solid["colorInput"]["readOnly"] is False, solid
            for stroke in solid["strokes"]:
                assert stroke["stroke"] == "rgb(255, 0, 0)", (
                    f"solid colour did not reach the map: {solid}"
                )
                assert stroke["strokeWidth"] == "6px", (
                    f"solid width did not reach the map: {solid}"
                )

            # Let the solid write's debounce land before the next call reads
            # storage (the record is written 100ms after the last input event).
            page.wait_for_timeout(300)

            # Back to ORIGINAL: the author's colour returns, the user's width
            # stays, the swatch is read-only again.
            restored = page.evaluate(
                _js("LayerControl/border_original_roundtrip"),
                ["Polygon data", "original"],
            )
            assert restored["mode"] == "original", restored
            assert restored["colorInput"]["readOnly"] is True, restored
            assert restored["colorInput"]["disabled"] is True, restored

            # Let the restored mode write's debounce land, then read the
            # record fresh — the storage snapshot inside the restored call was
            # taken before its own 100ms debounce had fired. The repaint from
            # the mode change also lands on the frame clock (throttleRaf), so
            # assert the computed style only after this wait let the frame fire.
            page.wait_for_timeout(300)
            final = page.evaluate(
                _js("LayerControl/border_original_roundtrip"), ["Polygon data"]
            )

            # The author's colour must be back and the user's width must ride
            # both modes.
            for stroke in final["strokes"]:
                assert stroke["stroke"] == "rgb(0, 0, 255)", (
                    f"author stroke not restored after round trip: {final}"
                )
                assert stroke["strokeWidth"] == "6px", (
                    f"user width lost after round trip: {final}"
                )

            # The stored record keeps the user's colour for the next solid
            # visit — ORIGINAL does not erase it.
            key = next(k for k in final["storage"] if "layer_state" in k)
            record = json.loads(final["storage"][key])
            entry = record["layers"].get(final["id"])
            assert entry, f"border state never persisted: {record}"
            assert entry["borderStyleMode"] == "original", (
                f"stored the wrong mode: {entry}"
            )
            assert entry["borderColor"] == "#ff0000", (
                f"the user's colour was erased on return: {entry}"
            )
            assert entry["borderWeight"] == 6, (
                f"the user's width was erased on return: {entry}"
            )

    def test_declared_border_follow_fill_is_the_default(self, browser, tmp_path):
        """A layer stamped foliplus={"border": {"mode": "follow_fill"}} opens its
        border mode on followFill with NO stored intent, and the map paints the
        leaf's current fill colour as the stroke (derived, never copied).

        The declaration is a read-time default: no stored border mode, no
        border colour — the panel shows followFill, the option is offered on a
        polygon, and the border takes the fill colour. A later user solid
        choice overrides it (intent > declaration); Reset returns to the
        declaration.
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        border_data = copy.deepcopy(load_geojson("common", "polygons_fuzhou_3offset"))
        for i, feat in enumerate(border_data["features"]):
            feat["properties"] = {"score": 10 + i}
        folium.GeoJson(
            json.dumps(border_data),
            name="Declared polygon data",
            style_function=lambda _f: {"fillColor": "#808080", "color": "#0000ff"},
            foliplus={"border": {"mode": "follow_fill"}},
        ).add_to(m)
        LayerControl(locale="en").add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_declared_border_follow_fill.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            baseline = page.evaluate(
                _js("LayerControl/declared_border_follow_fill"),
                ["Declared polygon data"],
            )
            assert baseline.get("row"), f"layer row not found: {baseline}"
            # No stored mode: the declaration is the default.
            assert baseline["mode"] == "followFill", baseline
            # The option is offered on a polygon.
            assert "followFill" in baseline["modes"], baseline
            # The border paints the leaf's fill colour (derived, not a copy).
            for stroke in baseline["strokes"]:
                assert stroke["stroke"] == "rgb(128, 128, 128)", (
                    f"declared follow_fill did not derive the fill colour: {baseline}"
                )
            # No border state was persisted (nothing the user owns).
            assert all(
                "borderStyleMode" not in json.loads(v)
                for v in baseline["storage"].values()
            ), baseline

            # A user solid choice overrides the declaration.
            solid = page.evaluate(
                _js("LayerControl/declared_border_follow_fill"),
                ["Declared polygon data"],
            )
            assert solid["row"], solid
            page.evaluate(
                snippet("LayerControl/set_border_mode"),
                ["Declared polygon data", "solid", "#ff0000"],
            )
            page.wait_for_timeout(300)
            after = page.evaluate(
                _js("LayerControl/declared_border_follow_fill"),
                ["Declared polygon data"],
            )
            assert after["mode"] == "solid", after
            for stroke in after["strokes"]:
                assert stroke["stroke"] == "rgb(255, 0, 0)", after

    def test_border_swatch_shows_a_named_color_as_hex(self, browser, tmp_path):
        """The swatch agrees with the map for a named authored color.

        folium's quickstart styles its faces with the named color ``gray``.
        The GeoJSON read used to return the layer's own options instead of
        its first feature's, which put a stroke the map was not painting into
        the panel — the same "the swatch disagrees with the map" defect,
        reached through the color form instead of through the layer tree.

        The face paints ``stroke="gray"``; the swatch must therefore read
        ``#808080``, the hex for that same color, not black and not
        Leaflet's default. The neighboring line keeps its own stroke, which
        pins the assertion to the color form rather than to anything the
        map does with it.
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "face_polygon_line_hangzhou")),
            name="Region",
            overlay=True,
            show=True,
            style_function=lambda f: (
                {"color": "gray", "weight": 1.5}
                if f["properties"]["kind"] == "face"
                else {"color": "#e74c3c", "weight": 6}
            ),
        ).add_to(m)
        LayerControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_border_named_color.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            row = page.evaluate(_js("LayerControl/border_set_and_read"), ["Region"])
            assert row.get("panel"), f"the style panel did not open: {row}"
            assert row["borderRows"] >= 1, f"expected the border rows: {row}"
            # gray as hex — not black, and not Leaflet's default.
            assert row["color"] == "#808080", (
                f"the swatch did not show the authored name as hex: {row}"
            )
            assert row["weight"] == "1.5", f"the width field did not take: {row}"

            strokes = {s["stroke"] for s in row["strokes"]}
            assert "gray" in strokes, (
                f"the face stopped painting the authored name\n{row['strokes']}"
            )
            assert "#e74c3c" in strokes, (
                f"the neighbouring line lost its own stroke\n{row['strokes']}"
            )
