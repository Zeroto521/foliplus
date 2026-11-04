"""Zoom-range declaration: browser behaviour and the documented contract.

The browser half drives a real Leaflet map: declare
``foliplus={"zoom_range": {"min": 8, "max": 12}}`` and the layer is painted
inside the range, gone outside it, and back when the map returns, while an
undeclared sibling is painted throughout and the style row opens on 8/12.

The render half pins the class docstring's promises (the mapping form, the
``gdf.explore`` writing form, warn-once and treated-as-undeclared) so a
docstring edit cannot silently drop a promise the behaviour tests rely on.
Assertions are semantic invariants, never the exact prose.
"""

from __future__ import annotations

import inspect
import json
import re

import folium
from conftest import _js, make_browser_page, panel_ready, use_page

from foliplus import LayerControl


def _class_doc() -> str:
    """The class docstring is the single contract surface for the declaration."""
    doc = inspect.getdoc(LayerControl)
    assert doc is not None, "LayerControl must carry a class docstring"
    return doc


_READ_STATE = _js("LayerControl/zoom_declared_state")
_READ_ROW = _js("LayerControl/zoom_declared_row")

# The class docstring is the single contract surface for the declaration; the
# Notes section (the last major section) holds the declaration tables and the
# resolution rules, so the probes anchor on the exact section header.
_DOC = _class_doc()
_NOTES = _DOC.split("Notes\n-----", 1)[1]


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
    _polygon("Declared", foliplus={"zoom_range": {"min": 8, "max": 12}}).add_to(m)
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
        _js("LayerControl/wait_declared_zoom_membership"), timeout=5000
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


def test_docstring_documents_zoom_mapping_form() -> None:
    """The zoom declaration is documented as a mapping with min and max."""
    # The Recognised-keys table names the ``zoom_range`` key.
    assert "``zoom_range``" in _DOC
    # The declaration-keys table names both mapping keys as the only shape.
    assert "``min``" in _DOC
    assert "``max``" in _DOC
    # The mapping form appears in the table (Type column = dict).
    assert "dict" in _NOTES


def test_docstring_documents_explore_writing_form() -> None:
    """The example writes the declaration through ``gdf.explore(foliplus=...)``."""
    assert "gdf.explore(foliplus=" in _DOC
    assert "zoom_range" in _DOC


def test_docstring_declares_malformed_warns_once_and_is_ignored() -> None:
    """Notes says a malformed declaration warns once and is never fatal."""
    assert "Warns once" in _NOTES
    assert "treated as undeclared" in _NOTES.lower()
    assert "never hides" in _NOTES


def test_docstring_declares_unusable_treated_as_undeclared() -> None:
    """Notes says an unusable range is treated as undeclared and stays visible."""
    assert "Treated as undeclared" in _NOTES
    assert "stays visible" in _NOTES
