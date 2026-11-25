"""Browser e2e: a REAL page reload after a feature filter keeps only the filtered subset.

The #1181 regression: a user sets a feature filter, reloads the page, the panel
keeps the condition (funnel icon) but the map renders the FULL data.

Reproduces the USER's exact flow from the quickstart:

- a real geopandas GeoDataFrame explored via ``.explore()`` (``marker_type="marker"``),
  which renders through folium's ``pointToLayer`` JS callback -- the ``geo_json_<md5>``
  path the user actually sees, NOT the simplified ``folium.GeoJson(marker=...)`` fixture
- 12 real GADM Shanghai districts with categorical ``NAME_3`` values
- the filter is applied through the panel write path (``setLayerFilter``),
  the page genuinely reloads, and the filter must STILL hide the excluded markers.

RED before the fix, GREEN after.
"""

from __future__ import annotations

import re
import time

import folium
import geopandas as gpd
import numpy as np
from conftest import _js, make_browser_page, use_page

from foliplus import LayerControl

DATA_GEOJSON = "doc/source/data/gadm41_CHN_3_Shanghai.geojson"
LAYER_NAME = "District Landmarks"

LAYER_READY_JS = (
    "() => { const c = window.__layerCtrl; if (!c) return false;"
    "  const api = window.map && window.map.foliplus && window.map.foliplus.LayerAPI;"
    "  if (!api) return false;"
    "  return api.layers.some(l => l.name === " + repr(LAYER_NAME) + "); }"
)


class TestExploreReloadBrowserBrowser:
    """Reload after filter on a real .explore() layer: only subset STILL shows."""

    @staticmethod
    def _explore_layer():
        """The quickstart District Landmarks layer (12 GADM Shanghai districts)."""
        boundary = gpd.read_file(DATA_GEOJSON)
        districts = boundary.copy()
        districts["geometry"] = boundary.to_crs(3857).centroid.to_crs(4326)
        np.random.seed(42)
        districts["population_density"] = np.random.randint(
            5_000, 30_000, len(districts)
        )
        return districts

    @staticmethod
    def _make_page(browser, tmp_path, slug="explore_reload"):
        districts = TestExploreReloadBrowserBrowser._explore_layer()
        m = folium.Map(location=[31.2, 121.4], zoom_start=10)
        LayerControl().add_to(m)
        districts.explore(
            m=m,
            name=LAYER_NAME,
            marker_type="marker",
            marker_kwds={
                "icon": folium.Icon(color="cadetblue", icon="map-pin", prefix="fa")
            },
            tooltip="NAME_3",
            popup=["NAME_3", "population_density"],
            legend=False,
        )
        html = m.get_root().render()
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found in rendered HTML"
        page, errors = make_browser_page(browser, tmp_path, html, slug)
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        page.wait_for_function(LAYER_READY_JS, timeout=10000)
        return page, errors

    def test_explore_reload_keeps_filtered_subset(self, browser, tmp_path):
        """Filter District Landmarks on NAME_3 -> only kept district shows ->
        REAL reload -> only kept district STILL shows (not the full 12)."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            pre = page.evaluate(_js("LayerControl/filter_reload_pre"))
            assert pre is not None, "pre-probe could not run"
            if "error" in pre:
                raise AssertionError(f"pre-probe error: {pre}")
            assert pre["hasVisibleDomOf"], (
                "visibleDomOf not on window.foliplus.core.layer"
            )
            assert pre["total"] >= 12, (
                "expected >=12 markers from .explore(), got {}".format(pre["total"])
            )

            for d in pre["before"]:
                for x in d:
                    assert x not in (None, "none"), (
                        f"before: display={x!r} not rendered"
                    )

            after_filter_hidden = sum(
                1 for d in pre["afterFilter"] for x in d if x == "none"
            )
            assert after_filter_hidden >= 1, "filter hid no marker: {}".format(
                pre["afterFilter"]
            )
            assert pre["filterState"] is not None, "filter not persisted"
            assert pre["persisted"] and "NAME_3" in pre["persisted"], (
                "filter not in localStorage before reload"
            )

            page.reload(wait_until="load")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_function(LAYER_READY_JS, timeout=10000)
            time.sleep(1.0)

            post = page.evaluate(_js("LayerControl/filter_reload_post"))
            assert post is not None, "post-probe could not run"
            if "error" in post:
                raise AssertionError(f"post-probe error: {post}")
            assert post["funnelPresent"], (
                "RELOAD BUG: filter condition NOT kept (no funnel) after reload"
            )
            after_reload_hidden = sum(
                1 for d in post["displays"] for x in d if x == "none"
            )
            assert after_reload_hidden >= 1, (
                "RELOAD BUG (#1181): filter lost after reload -- full data rendered: "
                "{} (filterState={})".format(post["displays"], post["filterState"])
            )
            assert not errors, f"JS errors: {errors}"
