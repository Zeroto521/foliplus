"""Browser test: a declared zoom range is the view the page opens on.

The unit tests pin the predicate; this drives a real Leaflet map, so the
claim under test is the user-visible one: declare
foliplus={"zoom": {"min": 8, "max": 12}}, open the page, and the layer is
painted inside the range, gone outside it, and back when the map returns -
while an undeclared sibling is painted throughout and the style row opens
on the declared 8/12.
"""

from __future__ import annotations

import json
import re

import folium
from conftest import _js, make_browser_page, panel_ready, use_page

from foliplus import LayerControl

_READ_STATE = _js("LayerControl/zoom_declared_state")
_READ_ROW = _js("LayerControl/zoom_declared_row")


def _polygon(name: str, **kwargs: object) -> folium.GeoJson:
    features = [
        {
            "type": "Feature",
            "properties": {"name": name},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [119.28, 26.06],
                        [119.32, 26.06],
                        [119.32, 26.10],
                        [119.28, 26.10],
                        [119.28, 26.06],
                    ]
                ],
            },
        }
    ]
    return folium.GeoJson(
        json.dumps({"type": "FeatureCollection", "features": features}),
        name=name,
        **kwargs,
    )


def _make_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=10)
    _polygon("Declared", foliplus={"zoom": {"min": 8, "max": 12}}).add_to(m)
    _polygon("Plain").add_to(m)
    LayerControl(locale="en").add_to(m)
    html = m.get_root().render()
    # Expose the control instance so the snippets can reach the row.
    html, n = re.subn(
        r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
        r"window.__layerCtrl = \1",
        html,
        count=1,
    )
    assert n == 1, "LayerControl instantiation not found in rendered HTML"
    page, errors = make_browser_page(browser, tmp_path, html, "zoom_declared")
    page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
    return page, errors


def _zoom_to(page, zoom: int) -> None:
    """Set the zoom and wait for the zoomend sweep to settle the policy.

    The sweep runs on `zoomend`; waiting on the declared layer's membership
    (rather than sleeping) is what makes the probe deterministic.
    """
    page.evaluate("(z) => window.map.setZoom(z)", zoom)
    page.wait_for_function("(z) => window.map.getZoom() === z", arg=zoom, timeout=5000)
    page.wait_for_function(
        """() => {
          const api = window.map.foliplus && window.map.foliplus.LayerAPI;
          const li = api && api.layers.find(l => l.name === "Declared");
          if (!li || !li.layer) return false;
          const z = window.map.getZoom();
          const inRange = z >= 8 && z <= 12;
          return window.map.hasLayer(li.layer) === inRange;
        }""",
        timeout=5000,
    )


class TestDeclaredZoomBrowser:
    def test_declared_range_is_the_view_the_page_opens_on(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)

            opened = page.evaluate(_READ_STATE)
            assert opened.get("error") is None, opened
            assert opened["zoom"] == 10, opened
            assert opened["declaredOnMap"] is True, opened
            assert opened["plainOnMap"] is True, opened
            assert opened["painted"] == 2, opened

            # The row opens on the declaration, not on the map's full range.
            row = page.evaluate(_READ_ROW)
            assert row.get("error") is None, row
            assert row["rowMin"] == 8, row
            assert row["rowMax"] == 12, row
            assert row["railMin"] <= 8 and row["railMax"] >= 12, row

            _zoom_to(page, 5)
            hidden = page.evaluate(_READ_STATE)
            assert hidden["declaredOnMap"] is False, hidden
            assert hidden["plainOnMap"] is True, hidden
            assert hidden["painted"] == 1, hidden
            # The policy hid it; the user chose nothing, so the box stays checked.
            assert hidden["declaredChecked"] is True, hidden

            _zoom_to(page, 10)
            back = page.evaluate(_READ_STATE)
            assert back["declaredOnMap"] is True, back
            assert back["plainOnMap"] is True, back
            assert back["painted"] == 2, back

            assert not errors, f"JS errors: {errors}"
