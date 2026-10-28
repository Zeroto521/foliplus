"""Shared helpers for MeasureControl browser tests."""

from __future__ import annotations

import re

import folium
from conftest import make_browser_page

from foliplus._cdn_loader import load_cdn

# CDN stubs keyed by the entry name returned by ``load_cdn``. Browser tests
# block all network, so the blocking CDN <script> tags the rendered HTML
# emits must be replaced with these inline stubs or the page never boots.
# Kept here so the two _make_page variants (with / without LayerControl)
# share one source of truth.
_TURF_STUB = (
    "<script>window.turf = { distance: (a,b,o) => "
    "L.latLng(a.geometry.coordinates[1],a.geometry.coordinates[0]).distanceTo("
    "L.latLng(b.geometry.coordinates[1],b.geometry.coordinates[0])), "
    "bearing: (a,b) => { const dL = "
    "(b.geometry.coordinates[0]-a.geometry.coordinates[0])*Math.PI/180; "
    "const l1 = a.geometry.coordinates[1]*Math.PI/180; "
    "const l2 = b.geometry.coordinates[1]*Math.PI/180; "
    "const y = Math.sin(dL)*Math.cos(l2); "
    "const x = Math.cos(l1)*Math.sin(l2)-Math.sin(l1)*Math.cos(l2)*Math.cos(dL); "
    "return (Math.atan2(y,x)*180/Math.PI+360)%360; }, "
    "area: (p) => { const R = 6378137; const d2r = Math.PI/180; "
    "const pts = p.geometry.coordinates[0]; let a = 0; "
    "for (let i = 0; i < pts.length-1; i++) { "
    "const p1 = pts[i], p2 = pts[i+1]; "
    "a += (p2[0] - p1[0]) * d2r * "
    "(2 + Math.sin(p1[1]*d2r) + Math.sin(p2[1]*d2r)); } "
    "return Math.abs(a * R * R / 2); }, "
    'point: (c) => ({ geometry: { coordinates: [c[0], c[1]], type: "Point" } }), '
    'polygon: (c) => ({ geometry: { coordinates: c, type: "Polygon" } }), '
    "midpoint: (a,b) => ({ geometry: { coordinates: "
    "[(a.geometry.coordinates[0]+b.geometry.coordinates[0])/2, "
    "(a.geometry.coordinates[1]+b.geometry.coordinates[1])/2], "
    'type: "Point" } }) };</script>'
)


def _stub_cdn(html: str, stubs: dict[str, str]) -> str:
    """Replace CDN <script> tags with inline stubs.

    ``load_cdn('MeasureControl')`` yields (name, url) pairs; each URL tag in
    the rendered HTML is swapped for ``stubs.get(name, "")``. Empty-string
    entries remove the tag entirely (nothing depends on that CDN).
    """
    for _name, url in load_cdn("MeasureControl"):
        html = html.replace(f'<script src="{url}"></script>', stubs.get(_name, ""))
    return html


def _make_page(browser, tmp_path, show_bearing=True, export_format="geojson"):
    """Build a page with MeasureControl and return (page, errors).

    Injects the test hooks that every browser test reads back:
    ``window.__measureCtrl`` (the control instance), ``window.__measureManager``
    (its lazily-created manager), ``window.__map``, and
    ``window.__measureStorageKey`` (STORAGE.KEY).
    """
    from foliplus import LayerControl, MeasureControl

    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    LayerControl().add_to(m)
    MeasureControl(show_bearing=show_bearing, export_format=export_format).add_to(m)

    html = m.get_root().render()
    # The manager is created lazily by the control's getter during addTo, so
    # expose the control first and read back its manager via `mgr` (dev build
    # keeps these names).
    html, n = re.subn(
        r"(new MeasureControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
        r"window.__measureCtrl = \1 "
        r"window.__measureManager = window.__measureCtrl.mgr; "
        r"window.__map = map; "
        r"window.__measureStorageKey = STORAGE.KEY;",
        html,
        count=1,
    )
    assert n == 1, "MeasureControl instantiation not found in rendered HTML"
    html = _stub_cdn(html, {"turf": _TURF_STUB})
    page, errors = make_browser_page(browser, tmp_path, html, "measure")
    page.wait_for_selector(".foliplus-measure-ctrl", state="attached", timeout=10000)
    return page, errors
