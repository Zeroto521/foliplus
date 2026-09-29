"""Leaflet bring-up smoke for pages that swap Folium's Leaflet pin.

Install is `folium>=0.14.0`; runtime is the TS controls against whatever
Leaflet Folium injects. This file rewrites that pin so a swapped Leaflet is
not a silent unknown. Bring-up only — not a compatibility proof. The rest of
the browser suite runs against Folium's Leaflet (1.9.3).

To widen (e.g. Leaflet 2.x): add the version to ``LEAFLET_COMPAT_VERSIONS``
and matching ``leaflet@<ver>/dist/leaflet.{js,css}`` entries to
``conftest._CDN_CACHE``. One smoke version per major line is enough.
"""

from __future__ import annotations

import re

import folium
import pytest
from conftest import make_browser_page, use_page

from foliplus import (
    FullscreenControl,
    LayerControl,
    LocateControl,
    MeasureControl,
    ScaleControl,
    SearchControl,
)

# Not a support range — foliplus does not pin Leaflet. 1.0.0 is the API
# floor (`map.getPane`); Folium's pin is covered by the rest of the suite.
LEAFLET_COMPAT_VERSIONS = ("1.0.0",)

# Exact root selectors per control. No class-substring or `.leaflet-bar`
# fallbacks — those pass even when the control never mounted.
MOUNTED_SELECTORS = (
    ".leaflet-container",
    ".foliplus-scale-wrap",
    ".foliplus-fullscreen-toggle",
    ".foliplus-locate-btn",
    ".foliplus-layer-ctrl",
    ".foliplus-measure-ctrl",
    ".foliplus-search",
)


def _rewrite_leaflet(html: str, version: str) -> str:
    """Pin Leaflet to *version* and drop helper CDNs (gcoord/turf)."""
    html = re.sub(r"leaflet@\d+\.\d+\.\d+", f"leaflet@{version}", html)
    html = html.replace(
        '<script src="https://cdn.jsdelivr.net/npm/gcoord@1/dist/gcoord.global.prod.js"></script>',
        "",
    )
    html = html.replace(
        '<script src="https://cdn.jsdelivr.net/npm/@turf/turf@7/turf.min.js"></script>',
        "",
    )
    return html


def _make_page(browser, tmp_path, version: str):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    for ctrl in (
        ScaleControl(),
        FullscreenControl(),
        LocateControl(),
        LayerControl(),
        MeasureControl(),
        SearchControl(),
    ):
        ctrl.add_to(m)
    html = _rewrite_leaflet(m.get_root().render(), version)
    return make_browser_page(browser, tmp_path, html, f"leaflet-{version}")


class TestLeafletCompatBrowser:
    """Bring-up smoke only — see module docstring."""

    @pytest.mark.parametrize("version", LEAFLET_COMPAT_VERSIONS)
    def test_controls_run_on_version(self, browser, tmp_path, version):
        with use_page(_make_page, browser, tmp_path, version) as (page, errors):
            for sel in MOUNTED_SELECTORS:
                page.wait_for_selector(sel, state="attached", timeout=15000)
            page.wait_for_selector(
                ".foliplus-panel-content[data-ready]", state="attached", timeout=10000
            )

            loaded, has_api = page.evaluate(
                """() => [
                (window.L && window.L.version || '').split('+')[0],
                !!(window.map && window.map.foliplus && window.map.foliplus.LayerAPI),
                ]"""
            )
            assert loaded == version, f"expected Leaflet {version}, got {loaded}"
            assert has_api, "map.foliplus.LayerAPI missing"

            page.click(".foliplus-measure-ctrl .foliplus-toggle-btn")
            page.wait_for_selector(
                ".foliplus-measure-ctrl.foliplus-is-expanded", timeout=5000
            )
            assert not errors, f"JS errors on Leaflet {version}: {errors}"
