"""Leaflet bring-up smoke — one advertised version at a time.

Scope is deliberately narrow: prove foliplus *loads and mounts* on a given
Leaflet (map init, control attach, panel ready, one panel expand, LayerAPI).
This is **not** a compatibility proof. Export/Heatmap private reaches,
measure drawing, search, layer drag, and the rest of the browser suite run
only against Folium's Leaflet pin (1.9.3).

Folium hard-pins that Leaflet in its template, so these tests rewrite the
pin and let the CDN proxy serve the target version from the cache.

To widen (e.g. Leaflet 2.x): append the version to
``LEAFLET_COMPAT_VERSIONS`` and add matching
``cdn.jsdelivr.net/npm/leaflet@<ver>/dist/leaflet.{js,css}`` entries to
``conftest._CDN_CACHE``. Prefer one smoke version per major line first.
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

# Versions CI must keep green. 1.0.0 is the advertised floor (`map.getPane`
# lands in Leaflet 1.0; 0.7.x is out).
#
# To widen (e.g. Leaflet 2.x): append the version here and add matching
# `cdn.jsdelivr.net/npm/leaflet@<ver>/dist/leaflet.{js,css}` entries to
# `conftest._CDN_CACHE` so the offline proxy can serve them. Prefer one
# smoke version per major line first; only fill out minors once a line is
# already green.
LEAFLET_COMPAT_VERSIONS = ("1.0.0",)


def _rewrite_leaflet(html: str, version: str) -> str:
    """Point the page at *version* of Leaflet and drop helper CDNs.

    gcoord/turf are unrelated to the Leaflet floor and would otherwise add
    a network dependency to a compatibility probe — same stub approach the
    MeasureControl browser tests already use.
    """
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
    """Render a multi-control map pinned to *version*; return (page, errors)."""
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    ScaleControl().add_to(m)
    FullscreenControl().add_to(m)
    LocateControl().add_to(m)
    LayerControl().add_to(m)
    MeasureControl().add_to(m)
    SearchControl().add_to(m)
    html = _rewrite_leaflet(m.get_root().render(), version)
    page, errors = make_browser_page(browser, tmp_path, html, f"leaflet-{version}")
    page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=15000)
    return page, errors


@pytest.mark.browser
class TestLeafletCompatBrowser:
    """Bring-up smoke only — see module docstring for what this does not prove."""

    @pytest.mark.parametrize("version", LEAFLET_COMPAT_VERSIONS)
    def test_controls_run_on_version(self, browser, tmp_path, version):
        with use_page(_make_page, browser, tmp_path, version) as (page, errors):
            page.wait_for_selector(
                ".foliplus-panel-content[data-ready]", state="attached", timeout=10000
            )
            checks = page.evaluate(
                """() => {
                const q = (s) => document.querySelector(s) !== null;
                return {
                    loaded: (window.L && window.L.version || '').split('+')[0],
                    map: q('.leaflet-container'),
                    layerCtrl: q('.foliplus-layer-ctrl'),
                    measureCtrl: q('.foliplus-measure-ctrl'),
                    scaleCtrl: q('.foliplus-scale-wrap'),
                    searchCtrl: q('[class*="foliplus-search"]'),
                    fullscreenCtrl: q('[class*="foliplus-fullscreen"]') || q('.leaflet-bar'),
                    locateCtrl: q('[class*="foliplus-locate"]') || q('.leaflet-bar'),
                    layerAPI: !!(window.map && window.map.foliplus
                                 && window.map.foliplus.LayerAPI),
                };
                }"""
            )
            assert checks["loaded"] == version, checks
            assert checks["map"] and checks["layerCtrl"] and checks["measureCtrl"]
            assert checks["scaleCtrl"] and checks["searchCtrl"], checks
            assert checks["fullscreenCtrl"] and checks["locateCtrl"], checks
            assert checks["layerAPI"], checks

            page.evaluate(
                "document.querySelector('.foliplus-measure-ctrl .foliplus-toggle-btn')?.click()"
            )
            page.wait_for_selector(
                ".foliplus-measure-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            assert not errors, f"JS errors on Leaflet {version}: {errors}"
