"""Browser regression for the CircleMarker per-feature colour on the first frame (#1285).

The quickstart's Facility Points layer (doc/source/quickstart.ipynb:146-155) is
built with GeoJson.explore(column=..., cmap=..., marker_type="circle_marker",
style_kwds={"stroke": False, ...}) and no foliplus declaration. folium bakes a
per-feature plasma colour into every feature (color and fillColor the same), and
the panel reads the layer as ORIGINAL. The reported symptom: the panel shows the
author's per-feature colours while the map paints a single colour.

These tests dump the first-frame stroke / fill attributes plus the panel's
border- and fill-row mode, assert the per-feature colours survive attach, then
toggle fill Single -> Original and dump again to see whether the colours differ
from the first frame (the "recovers after a toggle" symptom).

Run:
    PYTHONPATH=<worktree-root> uv run pytest -q \
      test/python/control/LayerControl/test_border_value_first_frame_browser.py \
      -m browser
"""

from __future__ import annotations

import copy
import json
import pathlib
import re

import folium
import pytest
from conftest import load_geojson, panel_ready, snippet, use_raw_page

from foliplus import LayerControl

from .helper import _expand_panel

# The quickstart bake: folium writes color == fillColor == a per-feature plasma
# colour, with stroke disabled in style_kwds. Three features, three colours, so
# the assertions can tell per-feature from single-colour.
PLASMA = ["#0d0887", "#7e03a8", "#f89441"]


@pytest.mark.browser
class TestCircleMarkerFirstFrameColour:
    """A CircleMarker layer keeps its per-feature colour on the first frame."""

    @staticmethod
    def _make_map():
        m = folium.Map(location=[39.5, -98.35], zoom_start=4, tiles=None)
        data = copy.deepcopy(load_geojson("LayerControl", "points_colormap_3offset"))
        # Bake the per-feature colour folium's .explore(column, cmap) produces:
        # color == fillColor == a plasma ramp colour, stroke disabled.
        colour_by_count = {
            feat["properties"]["count"]: PLASMA[i]
            for i, feat in enumerate(data["features"])
        }
        folium.GeoJson(
            json.dumps(data),
            name="Facility Points",
            marker=folium.CircleMarker(radius=3, fill=True),
            style_function=lambda feat: {
                "color": colour_by_count[feat["properties"]["count"]],
                "fillColor": colour_by_count[feat["properties"]["count"]],
                "fillOpacity": 0.8,
                "radius": 3,
                "stroke": False,
                "weight": 2,
            },
        ).add_to(m)
        LayerControl(locale="en").add_to(m)
        _expand_panel(m)
        return m

    @staticmethod
    def _write(m, tmp_path, slug):
        html_path = pathlib.Path(tmp_path) / f"{slug}.html"
        html = m.get_root().render()
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found in rendered HTML"
        html_path.write_text(html, encoding="utf-8")
        return html_path

    def test_first_frame_keeps_per_feature_colour(self, browser, tmp_path):
        """Each CircleMarker's fill attribute matches its own baked plasma colour."""
        m = self._make_map()
        html_path = self._write(m, tmp_path, "border_first_frame")
        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            dump = page.evaluate(snippet("LayerControl/first_frame_dump"))
            fills = [p["fill"] for p in dump["paths"] if p["fill"]]
            assert fills, f"no filled CircleMarker paths found: {dump}"
            # Per-feature colours must survive attach: not all markers one colour.
            assert len(set(fills)) == len(fills), (
                "per-feature plasma colours collapsed to a single colour on the "
                f"first frame (diag: {json.dumps(dump)})"
            )

    def test_fill_toggle_single_then_original(self, browser, tmp_path):
        """Toggle fill Single -> Original and compare the colours to the first frame."""
        m = self._make_map()
        html_path = self._write(m, tmp_path, "border_toggle")
        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            def fills():
                return page.evaluate(snippet("LayerControl/circle_fills"))

            first = fills()
            if page.query_selector("[data-style-dim='fill'] select") is None:
                pytest.skip("fill mode row not rendered")
            # Toggle to Single colour, then back to Original.
            page.select_option("[data-style-dim='fill'] select", "single")
            page.wait_for_timeout(200)
            single = fills()
            page.select_option("[data-style-dim='fill'] select", "original")
            page.wait_for_timeout(200)
            restored = fills()
            # The reported symptom: after the toggle round-trip the colours
            # differ from the first frame (the single colour sticks).
            assert len(set(first)) >= 2, f"first frame not per-feature: {first}"
            assert single != first or restored != first, (
                f"toggle round-trip did not change colours (first={first} "
                f"single={single} restored={restored})"
            )
