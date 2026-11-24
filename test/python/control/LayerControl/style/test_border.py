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
    def test_vector_border_writes_the_stroke_and_survives_reload(
        self, browser, tmp_path
    ):
        """A border change rewrites the vector's own stroke and outlives reload.

        Border is not part of the executor's visible / opacity / zoomRange
        family — the panel writes it with a direct ``setStyle`` — so nothing in
        the projection replay would restore it. Without its own replay the row
        could show the user's color while the map kept painting the author's
        stroke, which is the one failure mode this asserts against.
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        # The polygon rides inside a named, visible FeatureGroup: that is how a
        # data layer earns a panel row (a bare vector has no control of its own).
        layer = folium.GeoJson(
            load_geojson("LayerControl", "polygon_hangzhou_triangle")["features"][0],
            overlay=True,
            show=True,
            style_function=lambda f: {"color": "#0000ff", "weight": 2},
        )
        layer.layer_name = "Test Region"
        layer.add_to(m)
        LayerControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_vector_border_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            before = page.evaluate(
                _js("LayerControl/border_set_and_read"), ["Test Region"]
            )
            assert before.get("row"), f"layer row not found: {before}"
            assert before["strokes"], f"no stroked path on the map: {before}"
            for stroke in before["strokes"]:
                assert stroke["stroke"] == "#0000ff", (
                    f"author stroke never reached the map: {before}"
                )
                assert stroke["strokeWidth"] == "2", (
                    f"author width never reached the map: {before}"
                )

            row = page.evaluate(
                _js("LayerControl/border_set_and_read"),
                ["Test Region", "#ff0000", 6],
            )
            assert row.get("panel"), f"the style panel did not open: {row}"
            assert row["borderRows"] >= 1, f"expected the border rows: {row}"
            assert row["color"] == "#ff0000", f"swatch did not take: {row}"
            assert row["weight"] == "6", f"width field did not take: {row}"
            assert row["strokes"], f"the stroke never reached the map: {row}"
            for stroke in row["strokes"]:
                assert stroke["stroke"] == "#ff0000", (
                    f"the color change did not reach the SVG: {row}"
                )
                assert stroke["strokeWidth"] == "6", (
                    f"the width change did not reach the SVG: {row}"
                )

            # Let the debounce commit, then reload — the stored record is the
            # only thing that survives.
            page.wait_for_timeout(300)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            after = page.evaluate(
                _js("LayerControl/border_set_and_read"), ["Test Region"]
            )
            assert after.get("panel"), f"the style panel did not reopen: {after}"
            assert after["color"] == "#ff0000", (
                f"reload reverted the border color: {after}"
            )
            assert after["weight"] == "6", f"reload reverted the border width: {after}"
            assert after["strokes"], f"no stroked path after reload: {after}"
            for stroke in after["strokes"]:
                assert stroke["stroke"] == "#ff0000", (
                    f"reload dropped the border stroke\n{after}"
                )
                assert stroke["strokeWidth"] == "6", (
                    f"reload dropped the border width\n{after}"
                )

            key = next(k for k in after["storage"] if "layer_state" in k)
            record = json.loads(after["storage"][key])
            # The record is keyed by folium's generated id, not the label the
            # row displays.
            entry = record["layers"].get(after["id"])
            assert entry, f"border state never persisted: {record}"
            assert entry["borderColor"] == "#ff0000", f"stored the wrong color: {entry}"
            assert entry["borderWeight"] == 6, f"stored the wrong width: {entry}"

    def test_heatmap_keeps_its_own_border_row_only(self, browser, tmp_path):
        """The delegated drawer owns the heatmap's border, so one row total.

        The generic border row must never render next to the drawer's own
        border row in the same panel — the two write through different paths
        and would fight over the same visual axis.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        # The heatmap only earns a panel row once it has a point layer to
        # aggregate, so give it one — its id is the stable component id.
        folium.GeoJson(
            json.dumps(
                feature_collection(point_feature(119.30, 26.08, {"val": 26.08}))
            ),
            name="Points",
            show=True,
        ).add_to(m)
        # The border row label is read in English, so pin the page locale.
        LayerControl(locale="en").add_to(m)
        HeatmapControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_border_heatmap.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            heatmap_ready(page, timeout=15000)
            panel_ready(page)
            page.wait_for_timeout(200)

            panel = page.evaluate(
                _js("LayerControl/border_set_and_read"), ["foliplus_heatmap"]
            )
            assert panel.get("panel"), f"the heatmap panel did not open: {panel}"
            # The drawer builds its own border row with the shared FORM_ROW
            # chrome but not the vector row's class.
            assert panel["borderRows"] == 0, (
                f"the vector border row rendered for a delegated layer: {panel}"
            )
            assert panel["labels"].count("Border") == 1, (
                f"expected exactly one border row, got: {panel['labels']}"
            )

    def test_circlemarker_stroke_false_border_write_is_visible_and_resettable(
        self, browser, tmp_path
    ):
        """A stroke:false CircleMarker must show a user border, and Reset must hide it again.

        quickstart Facility Points authors ``style_kwds={"stroke": False}``
        (geopandas explore → folium CircleMarker). Writing color/weight alone
        leaves Path painting ``stroke=none`` — the panel change would be a
        silent no-op. The write must turn stroke on; Reset must put the
        author's ``stroke: False`` back so the border disappears again.
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        folium.GeoJson(
            json.dumps(feature_collection(point_feature(120.0, 30.0))),
            name="Facility Points",
            overlay=True,
            show=True,
            marker=folium.CircleMarker(
                [30.0, 120.0],
                radius=5,
                color="#3388ff",
                weight=2,
                fill=True,
                fill_opacity=0.8,
                stroke=False,
            ),
        ).add_to(m)
        LayerControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_circlemarker_stroke_false_border.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            before = page.evaluate(
                _js("LayerControl/border_set_and_read"), ["Facility Points"]
            )
            assert before.get("panel"), f"the style panel did not open: {before}"
            assert before["borderRows"] >= 1, f"expected the border rows: {before}"
            for stroke in before["strokes"]:
                assert stroke["stroke"] in (None, "none"), (
                    f"author stroke:false should paint stroke=none: {before}"
                )

            row = page.evaluate(
                _js("LayerControl/border_set_and_read"),
                ["Facility Points", "#ff0000", 6],
            )
            assert row.get("panel"), f"the style panel did not open: {row}"
            assert row["strokes"], f"no path on the map: {row}"
            for stroke in row["strokes"]:
                assert stroke["stroke"] == "#ff0000", (
                    f"border color did not reach the SVG: {row}"
                )
                assert stroke["strokeWidth"] == "6", (
                    f"border width did not reach the SVG: {row}"
                )

            reset = page.evaluate(
                _js("LayerControl/border_set_and_read"),
                ["Facility Points", None, None, True],
            )
            assert reset.get("panel"), f"the style panel did not reopen: {reset}"
            assert reset["strokes"], f"no path after reset: {reset}"
            for stroke in reset["strokes"]:
                assert stroke["stroke"] in (None, "none"), (
                    f"reset must restore the author's stroke:false\n{reset}"
                )

    def test_circlemarker_size_row_writes_radius_and_reset_restores_authored(
        self, browser, tmp_path
    ):
        """The Size row writes every pixel-radius leaf; Reset restores the author's.

        Two CircleMarker radii (5 and 9) share one FeatureGroup. Typing 30
        must reach both leaves -- getRadius() and what the SVG is painting --
        and persist as layers[id].size == 30. Reset must bring back 5 and 9, not
        the user's last choice of 30: the authored radius is captured on the
        layer's first write, so a re-read would restore the user's own number
        and every keystroke would compound.
        A Polygon on the same map has no pixel-radius leaf, so its style
        panel must not render the row at all.
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        folium.GeoJson(
            json.dumps(
                feature_collection(
                    point_feature(120.0, 30.0, {"radius": 5, "color": "#3388ff"}),
                    point_feature(120.02, 30.02, {"radius": 9, "color": "#e74c3c"}),
                )
            ),
            name="Facility Points",
            overlay=True,
            show=True,
            marker=folium.CircleMarker(
                [0, 0],
                radius=5,
                color="#3388ff",
                weight=2,
                fill=True,
                fill_opacity=0.8,
            ),
            style_function=lambda f: {
                "radius": f["properties"]["radius"],
                "color": f["properties"]["color"],
            },
        ).add_to(m)
        folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "polygon_hangzhou_square")),
            name="Test Region",
            overlay=True,
            show=True,
            style_function=lambda f: {
                "color": "#3388ff",
                "weight": 2,
                "fill": True,
                "fillOpacity": 0.2,
            },
        ).add_to(m)
        LayerControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_circlemarker_size_row.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            before = page.evaluate(_js("LayerControl/size_row"), ["Facility Points"])
            assert before.get("panel"), f"the style panel did not open: {before}"
            assert before.get("sizeRow"), f"the Size row did not render: {before}"
            assert before["sizeRows"] == 1, f"expected exactly one Size row: {before}"
            assert len(before["leaves"]) == 2, (
                f"expected both authored markers: {before}"
            )
            assert {leaf["radius"] for leaf in before["leaves"]} == {5, 9}, (
                f"the authored radii were already wrong before any write: {before}"
            )
            assert before["storage"] is None, (
                f"an untouched visit stored a size: {before}"
            )
            layout = before.get("sizeLayout")
            assert layout, f"the Size field was not measurable: {before}"
            assert layout["textAlign"] == "right", (
                f"a unit-suffixed Size value must be right-aligned: {layout}"
            )
            assert layout["rightGap"] <= 1, (
                f"the Size box must sit at the right edge of its column: {layout}"
            )

            after = page.evaluate(_js("LayerControl/size_row"), ["Facility Points", 30])
            assert after.get("panel"), f"the style panel did not reopen: {after}"
            assert after["sizeRows"] == 1, f"the Size row disappeared: {after}"
            assert after["sizeInput"] == "30", (
                f"the field did not keep the typed value: {after}"
            )
            assert len(after["leaves"]) == 2, f"no leaves to write to: {after}"
            for leaf in after["leaves"]:
                assert leaf["radius"] == 30, (
                    f"the radius did not reach the leaf: {after}"
                )
                assert leaf["svgRadius"] == 30, (
                    f"the SVG did not repaint the radius: {leaf}"
                )
            assert after["storage"] is not None, f"no persisted entry: {after}"
            assert after["storage"].get("size") == 30, (
                f"the persisted entry did not carry the size: {after}"
            )
            assert "size" in (after["storage"].get("overrides") or []), (
                f"the persisted size carried no provenance marker: {after}"
            )

            reset = page.evaluate(
                _js("LayerControl/size_row"), ["Facility Points", None, True]
            )
            assert reset.get("panel"), f"the style panel did not reopen: {reset}"
            assert len(reset["leaves"]) == 2, f"no leaves after reset: {reset}"
            assert {leaf["radius"] for leaf in reset["leaves"]} == {5, 9}, (
                f"reset must restore the author's radii, not the last choice: {reset}"
            )
            assert {leaf["svgRadius"] for leaf in reset["leaves"]} == {5, 9}, (
                f"the SVG did not repaint the authored radii: {reset}"
            )
            assert reset["storage"] is None or "size" not in reset["storage"], (
                f"reset did not drop the persisted size: {reset}"
            )

            polygon = page.evaluate(_js("LayerControl/size_row"), ["Test Region"])
            assert polygon.get("panel"), (
                f"the polygon's style panel did not open: {polygon}"
            )
            assert polygon["sizeRows"] == 0, (
                f"the Size row must not render for a polygon: {polygon}"
            )
            assert polygon["storage"] is None or "size" not in polygon["storage"], (
                f"reading the polygon stored a size: {polygon}"
            )

    @pytest.mark.parametrize(
        "fill_mode,border_mode",
        [
            ("original", "original"),
            ("original", "solid"),
            ("solid", "original"),
            ("solid", "solid"),
        ],
    )
    def test_style_fill_and_border_number_boxes_share_one_slot(
        self, browser, tmp_path, fill_mode, border_mode
    ):
        """The fill opacity box and the border weight box occupy one flex slot.

        The two rows read as one grid: the number-like box (the fill opacity
        input in solid mode, the readonly original-value box in original mode)
        and the border weight input share the same width and the same inline
        group, in every mode combination. A regression that widens one without
        the other breaks the alignment the drawer promises.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._ramp_layer(),
            slug=f"fill_border_box_{fill_mode}_{border_mode}",
        ) as (page, errors):
            self._open_style_ramp(page)
            result = page.evaluate(
                _js("LayerControl/read_fill_border_number_boxes"),
                {"fillMode": fill_mode, "borderMode": border_mode},
            )
            assert result.get("ok"), result
            assert result["fillMode"] == fill_mode, result
            assert result["borderMode"] == border_mode, result
            assert result["fillNumber"] is not None, result
            assert result["borderNumber"] is not None, result
            # The two number boxes share the same width within a pixel.
            assert result["fillNumber"]["w"] == pytest.approx(
                result["borderNumber"]["w"], abs=1
            ), result
            # The two inline groups share the same flex slot width within a
            # pixel, so the boxes land on the same column edge.
            assert result["fillInline"]["w"] == pytest.approx(
                result["borderInline"]["w"], abs=1
            ), result
            assert not errors, f"JS errors: {errors}"
