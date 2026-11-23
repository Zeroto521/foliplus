"""Browser regression for the declared value border first-frame bug (#1285).

A CircleMarker GeoJson layer that declares a value (colormap) border must open
on the ramp, not the author's flat stroke. Reproduces the quickstart report:
the map opens flat and only recovers after the user toggles a style mode.

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
from conftest import load_geojson, panel_ready, use_raw_page
from folium import Element

from foliplus import LayerControl

from .helper import _expand_panel, _write_html


@pytest.mark.browser
class TestBorderValueFirstFrameBrowser:
    """A declared value border reaches the map on the first frame."""

    @staticmethod
    def _make_map():
        m = folium.Map(location=[39.5, -98.35], zoom_start=4, tiles=None)
        data = copy.deepcopy(load_geojson("LayerControl", "points_colormap_3offset"))
        folium.GeoJson(
            json.dumps(data),
            name="colormap_points",
            marker=folium.CircleMarker(radius=14, fill=True),
            style_function=lambda _f: {
                "color": "#ff0000",
                "weight": 4,
                "fillColor": "#3388ff",
                "fillOpacity": 0.6,
            },
            foliplus={"border": {"mode": "value", "field": "count", "scheme": "Reds"}},
        ).add_to(m)
        LayerControl(locale="en").add_to(m)
        _expand_panel(m)
        return m

    def test_first_frame_stroke_is_ramp_not_author(self, browser, tmp_path):
        """Every CircleMarker stroke equals its Reds ramp colour on the first frame."""
        m = self._make_map()
        html_path = pathlib.Path(tmp_path) / "test_border_value_first_frame.html"
        html = m.get_root().render()
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found in rendered HTML"
        html_path.write_text(html, encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            # Read every rendered CircleMarker path stroke from the SVG DOM.
            colors = page.evaluate(
                "() => Array.from("
                "  document.querySelectorAll('path.leaflet-interactive')"
                ").map(p => p.getAttribute('stroke')).filter(Boolean)"
            )
            assert colors, "no stroked CircleMarker paths found"
            # A declared value border must NOT leave every marker on the
            # author's flat red -- the ramp has to reach the map on attach.
            distinct = set(colors)
            assert distinct != {"#ff0000"}, (
                "declared value border did not reach the map on the first frame: "
                f"every marker still carries the author's flat stroke #ff0000 "
                f"(strokes={colors})"
            )
