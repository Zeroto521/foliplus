"""Shared helpers for LayerControl tests."""

from __future__ import annotations

import re

import folium
from conftest import load_geojson
from folium import Element

_geo_mixed = load_geojson("LayerControl", "mixed")

_tiny_png = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _write_html(m: folium.Map, path) -> None:
    """Render *m* to *path*, exposing the map as ``window.map``.

    Snippets run in ``page.evaluate`` and reach per-map state through
    ``window.map.foliplus``. ``use_raw_page`` does not apply this (only
    ``make_browser_page`` does), and the tag order matters: the map variable
    is declared by a script at the end of ``</body>``, so the assignment has
    to come after it -- appending to ``m.get_root().html`` lands inside
    ``</head>``, which is too early.
    """
    html = m.get_root().render()
    match = re.search(r"var (map_[0-9a-f]+) = L\.map", html)
    if match:
        html = html.replace(
            "</html>",
            f"<script>window.map = {match.group(1)};</script></html>",
        )
    path.write_text(html, encoding="utf-8")


def _expand_panel(m: folium.Map) -> None:
    """Expand the LayerControl panel on load.

    The panel ships collapsed, and the map's inline script (LayerControl's
    own IIFE) runs before ``DOMContentLoaded`` -- so the click has to be
    scheduled after it. Needed for reload tests: after a reload there is no
    interaction left in the test to expand it, and the rows are not rendered
    until the panel opens.
    """
    m.get_root().html.add_child(
        Element(
            '<script>document.addEventListener("DOMContentLoaded", function () {'
            "  var c = document.querySelector('.foliplus-layer-ctrl');"
            "  if (c) c.querySelector('.foliplus-toggle-btn').click();"
            "});</script>"
        )
    )
