"""Browser e2e: the quickstart Facility Points layer must paint per-feature plasma.

The #1285 real reproduction, from the quickstart (doc/source/quickstart.ipynb:146-155):

    facilities.explore(
        m=m, name="Facility Points",
        column="score", cmap="plasma",
        marker_type="circle_marker",
        style_kwds={"radius": 3, "fillOpacity": 0.8, "stroke": False},
        legend=False, show=False,
    )

No foliplus= declaration, stroke=False (no outline), and a per-feature colour
that comes from column="score" through the plasma cmap — every circle marker
carries a DIFFERENT fill sampled from the colormap at its own score.

The reported failure: the LayerControl panel shows "original colouring" while the
map renders a SINGLE colour. This test pins the first-frame contract: every
path.leaflet-interactive must carry its own plasma fill (distinct fills across
markers), not one collapsed colour.

RED while the first frame collapses the ramp, GREEN once the per-feature colour
survives to the DOM.
"""

from __future__ import annotations

import re

import folium
import geopandas as gpd
from conftest import _js, load_geojson, make_browser_page, use_page

from foliplus import LayerControl

DATA_GEOJSON = "test/data/LayerControl/geojson/quickstart_facility_points_6.geojson"
LAYER_NAME = "Facility Points"


class TestQuickstartFacilityPointsBrowser:
    """First-frame per-feature plasma colour survives to the DOM."""

    @staticmethod
    def _explore_layer():
        """The quickstart Facility Points layer: 6 points scored 0..100."""
        return gpd.read_file(DATA_GEOJSON)

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
            for feat in load_geojson(
                "LayerControl", "quickstart_facility_points_6"
            )["features"]
        ]
        xs = np.array(scores, dtype=float) / 100.0
        return [matplotlib.colors.to_hex(cm.plasma(x)) for x in xs]

    @staticmethod
    def _make_page(browser, tmp_path, slug="quickstart_facility_points"):
        facilities = TestQuickstartFacilityPointsBrowser._explore_layer()
        m = folium.Map(location=[26.1, 119.3], zoom_start=11)
        LayerControl().add_to(m)
        facilities.explore(
            m=m,
            name=LAYER_NAME,
            column="score",
            cmap="plasma",
            marker_type="circle_marker",
            style_kwds={"radius": 3, "fillOpacity": 0.8, "stroke": False},
            legend=False,
            show=False,
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
        return page, errors

    def test_first_frame_paints_per_feature_plasma(self, browser, tmp_path):
        """Every circle marker carries its own plasma fill on the first frame."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            dump = page.evaluate(_js("LayerControl/quickstart_first_frame_dump"))
            assert dump is not None, "first-frame dump could not run"
            if "error" in dump:
                raise AssertionError(f"first-frame dump error: {dump}")

            markers = dump["markers"]
            assert dump["markerCount"] >= 6, (
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


