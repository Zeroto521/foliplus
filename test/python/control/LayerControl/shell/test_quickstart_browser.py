"""Browser e2e for the quickstart scenarios: per-feature colour, the full map and reload.

Three scenarios share the rendered page shape and the reload probes:

- Facility Points (#1285, doc/source/quickstart.ipynb:146-155): a no-foliplus
  `.explore(column="score", cmap="plasma")` layer must paint a DISTINCT plasma
  fill per feature on the first frame, not one collapsed colour.
- Full quickstart (#1181): all eight controls plus the four explore layers;
  a feature filter on District Landmarks survives a real page reload and the
  map renders only the kept subset.
- Explore reload (#1181): the same reload contract narrowed to one real
  `.explore()` layer driven through folium's `pointToLayer` path.

Each scenario is a class; the module-level fixtures (geodata path, layer name,
reload probe) are shared so a new scenario reuses them instead of cloning them.
"""

from __future__ import annotations

import re
import time

import folium
import geopandas as gpd
import numpy as np
import pandas as pd
from conftest import _js, load_geojson, make_browser_page, snippet, use_page
from shapely.geometry import LineString

from foliplus import (
    ExportControl,
    FullscreenControl,
    HeatmapControl,
    LayerControl,
    LocateControl,
    MeasureControl,
    ScaleControl,
    SearchControl,
)

from ..helper import _expand_panel

FACILITY_GEOJSON = "test/data/LayerControl/geojson/quickstart_facility_points_6.geojson"
DISTRICT_GEOJSON = "doc/source/data/gadm41_CHN_3_Shanghai.geojson"
FACILITY_LAYER_NAME = "Facility Points"
DISTRICT_LAYER_NAME = "District Landmarks"

LAYER_READY_JS = (
    "() => { const c = window.__layerCtrl; if (!c) return false;"
    "  const api = window.map && window.map.foliplus && window.map.foliplus.LayerAPI;"
    "  if (!api) return false;"
    "  return api.layers.some(l => l.name === " + repr(DISTRICT_LAYER_NAME) + "); }"
)


def _points_frame(df: pd.DataFrame) -> gpd.GeoDataFrame:
    """The quickstart's from_xy helper, without the dtoolkit dependency."""
    return gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df["x"], df["y"]), crs=4326)


def _lines_frame(df: pd.DataFrame) -> gpd.GeoDataFrame:
    """The quickstart's to_line helper, without the dtoolkit dependency."""
    geometry = [
        LineString([(row.x1, row.y1), (row.x2, row.y2)])
        for row in df.itertuples(index=False)
    ]
    return gpd.GeoDataFrame(df, geometry=geometry, crs=4326)


class TestQuickstartFacilityPoints:
    """First-frame per-feature plasma colour survives to the DOM."""

    @staticmethod
    def _explore_layer():
        """The quickstart Facility Points layer: 6 points scored 0..100."""
        return gpd.read_file(FACILITY_GEOJSON)

    @staticmethod
    def _expected_fills():
        """The plasma hex each score should sample to (score / 100 -> cmap).

        Computed here rather than hardcoded so the assertion tracks the colormap
        and the feature order, not a frozen list of hexes.
        """
        import matplotlib
        import numpy as np
        from matplotlib import cm

        scores = [
            feat["properties"]["score"]
            for feat in load_geojson("LayerControl", "quickstart_facility_points_6")[
                "features"
            ]
        ]
        xs = np.array(scores, dtype=float) / 100.0
        return [matplotlib.colors.to_hex(cm.plasma(x)) for x in xs]

    @staticmethod
    def _make_page(browser, tmp_path, slug="quickstart_facility_points"):
        facilities = TestQuickstartFacilityPoints._explore_layer()
        m = folium.Map(location=[26.1, 119.3], zoom_start=11)
        LayerControl().add_to(m)
        facilities.explore(
            m=m,
            name=FACILITY_LAYER_NAME,
            column="score",
            cmap="plasma",
            marker_type="circle_marker",
            style_kwds={"radius": 3, "fillOpacity": 0.8, "stroke": False},
            legend=False,
        )
        _expand_panel(m)
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
        # .explore defaults the layer to hidden; click its checkbox to render
        # the CircleMarkers to SVG before the test reads the first frame.
        # The layer ships hidden (show=False or .explore default).
        page.evaluate(snippet("LayerControl/show_all_layers"))
        page.wait_for_selector("path.leaflet-interactive", timeout=10000)
        return page, errors

    def test_first_frame_paints_per_feature_plasma(self, browser, tmp_path):
        """Every circle marker carries its own plasma fill on the first frame."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            dump = page.evaluate(snippet("LayerControl/quickstart_first_frame_dump"))
            assert dump is not None, "first-frame dump could not run"
            if "error" in dump:
                raise AssertionError(f"first-frame dump error: {dump}")

            markers = dump["markers"]
            assert dump["markerCount"] == 6, (
                "expected >=6 circle markers from .explore(), got {}".format(
                    dump["markerCount"]
                )
            )

            # Each marker is filled (fillOpacity 0.8 -> a real fill attribute)
            # and has NO stroke (style_kwds stroke=False -> no visible outline).
            for i, marker in enumerate(markers):
                assert marker["fillPresent"], (
                    f"marker {i}: no fill attribute painted: {marker}"
                )
                assert not marker["strokePresent"], (
                    f"marker {i}: expected stroke=False but an outline is painted: "
                    f"{marker}"
                )

            # The core contract: DISTINCT per-feature plasma fills, not one
            # collapsed colour. distinctFills must equal the marker count.
            assert dump["distinctFills"] == len(markers), (
                "first frame collapsed the plasma ramp to a single colour: "
                "distinctFills={} over {} markers; fills={}".format(
                    dump["distinctFills"],
                    len(markers),
                    [m["fill"] for m in markers],
                )
            )

            # And each marker's fill matches the plasma sample for its own score.
            expected = self._expected_fills()
            for i, marker in enumerate(markers):
                got = (marker["fill"] or "").lower()
                want = expected[i % len(expected)].lower()
                assert got == want, (
                    f"marker {i}: fill {got!r} != plasma(score) {want!r}"
                )

            assert not errors, f"JS errors: {errors}"


class TestQuickstartReload:
    """The user's exact quickstart flow: filter -> reload -> subset still shows."""

    @staticmethod
    def _quickstart_map():
        boundary = gpd.read_file(DISTRICT_GEOJSON)
        districts = boundary.copy()
        districts["geometry"] = boundary.to_crs(3857).centroid.to_crs(4326)
        np.random.seed(42)
        districts["population_density"] = np.random.randint(
            5_000, 30_000, len(districts)
        )

        bounds = boundary.total_bounds
        facilities = (
            _points_frame(
                pd.DataFrame(
                    {
                        "x": np.random.uniform(bounds[0], bounds[2], 5_000),
                        "y": np.random.uniform(bounds[1], bounds[3], 5_000),
                        "score": np.random.randint(1, 5_000, 5_000),
                    }
                )
            )
            .sjoin(boundary, how="inner")
            .groupby("NAME_3")
            .sample(n=500, random_state=42, replace=True)
            .reset_index(drop=True)
        )

        center = districts.union_all().centroid
        m = folium.Map(location=[center.y, center.x], zoom_start=10, tiles=None)
        folium.TileLayer(
            "Esri.WorldGrayCanvas", name="Light Canvas", max_zoom=16
        ).add_to(m)
        folium.TileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
            name="Dark Canvas",
            attr="Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
            max_zoom=16,
            show=False,
        ).add_to(m)
        folium.TileLayer("OpenStreetMap", name="OpenStreetMap", show=False).add_to(m)

        # Layers first, controls after — the quickstart order (and the order
        # that used to lose the filter on reload).
        districts.explore(
            m=m,
            name=DISTRICT_LAYER_NAME,
            marker_type="marker",
            marker_kwds={
                "icon": folium.Icon(color="cadetblue", icon="map-pin", prefix="fa")
            },
            tooltip="NAME_3",
            popup=["NAME_3", "population_density"],
            legend=False,
        )
        facilities.explore(
            m=m,
            name="Facility Points",
            column="score",
            cmap="plasma",
            marker_type="circle_marker",
            style_kwds={"radius": 3, "fillOpacity": 0.8, "stroke": False},
            legend=False,
            show=False,
        )
        boundary.explore(
            m=m,
            name="Municipal Boundaries",
            foliplus={"label": {"field": "NAME_3", "collide": False}},
            color="gray",
            style_kwds={"fillOpacity": 0.05, "weight": 1.5, "dashArray": "5, 5"},
            tooltip="NAME_3",
            popup=True,
            legend=False,
        )
        (
            _lines_frame(
                pd.DataFrame(
                    {
                        "x1": districts.geometry.x[::2].values,
                        "y1": districts.geometry.y[::2].values,
                        "x2": districts.geometry.x[1::2].values,
                        "y2": districts.geometry.y[1::2].values,
                        "route_name": [
                            f"Route {i}" for i in range(len(districts.geometry.x[::2]))
                        ],
                    }
                )
            ).explore(
                m=m,
                name="Commuting Routes",
                color="#e74c3c",
                style_kwds={"weight": 6, "opacity": 0.9, "dashArray": "10 10"},
                highlight_kwds={"weight": 8},
                tooltip="route_name",
                legend=False,
                show=False,
            )
        )

        SearchControl().add_to(m)
        LayerControl().add_to(m)
        HeatmapControl(agg="sum").add_to(m)
        ScaleControl().add_to(m)
        MeasureControl().add_to(m)
        ExportControl().add_to(m)
        FullscreenControl(hide_self=False, hide_others=False).add_to(m)
        LocateControl().add_to(m)
        return m

    @staticmethod
    def _make_page(browser, tmp_path, slug="quickstart_reload"):
        m = TestQuickstartReload._quickstart_map()
        html = m.get_root().render()
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found in rendered HTML"
        page, errors = make_browser_page(browser, tmp_path, html, slug)
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=15000)
        page.wait_for_function(LAYER_READY_JS, timeout=15000)
        return page, errors

    def test_quickstart_reload_keeps_filtered_subset(self, browser, tmp_path):
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
                ".foliplus-layer-ctrl", state="attached", timeout=15000
            )
            page.wait_for_function(LAYER_READY_JS, timeout=15000)
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


class TestExploreReload:
    """Reload after filter on a real .explore() layer: only subset STILL shows."""

    @staticmethod
    def _explore_layer():
        """The quickstart District Landmarks layer (12 GADM Shanghai districts)."""
        boundary = gpd.read_file(DISTRICT_GEOJSON)
        districts = boundary.copy()
        districts["geometry"] = boundary.to_crs(3857).centroid.to_crs(4326)
        np.random.seed(42)
        districts["population_density"] = np.random.randint(
            5_000, 30_000, len(districts)
        )
        return districts

    @staticmethod
    def _make_page(browser, tmp_path, slug="explore_reload"):
        districts = TestExploreReload._explore_layer()
        m = folium.Map(location=[31.2, 121.4], zoom_start=10)
        LayerControl().add_to(m)
        districts.explore(
            m=m,
            name=DISTRICT_LAYER_NAME,
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
