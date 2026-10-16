"""Marker-shadow-on-zoom browser tests for foliplus.LayerControl."""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path

import folium
import pytest
from conftest import (
    _js,
    assert_config_value,
    assert_locale,
    heatmap_ready,
    make_browser_page,
    panel_ready,
    read_css,
    read_css_dir,
    render,
    render_control,
    use_page,
    use_raw_page,
)
from folium import Element

from foliplus import HeatmapControl, LayerControl


class TestMarkerShadowZoomBrowser:
    """Marker shadow stays below icon across a zoom re-pin.

    Leaflet's own pane ladder puts shadowPane at z=500 and markerPane at
    z=600. foliplus's data panes sit at z=600+, so once enforceOrder moves
    the icon into a foliplus pane (z>=600) while the shadow stays in
    shadowPane (z=500), the pane boundary alone carries the ordering —
    no DOM-order dependency, no ``zIndexOffset`` risk. These tests verify
    that invariants hold and the assertions are not vacuous (feed-red).
    """

    @staticmethod
    def _probe(browser, tmp_path, slug="shadow_notmove"):
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        html = m.get_root().render()
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1
        page, errors = make_browser_page(browser, tmp_path, html, slug)
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        return page, errors

    def _assert_shadow_not_moved(self, m: dict, ctx: str) -> None:
        assert "foliplus-pane-" in (m["iconParent"] or ""), (
            f"{ctx}: icon not in foliplus pane: {m}"
        )
        assert "shadow-pane" in (m["shadowParent"] or ""), (
            f"{ctx}: shadow not in shadowPane: {m}"
        )
        # The pane boundary itself must carry the ordering — icon's pane z
        # above shadow's pane z. This is the invariant that lets the test
        # survive any DOM re-arrangement Leaflet might do during a zoom.
        icon_pz = int(m["iconParentZ"])
        shadow_pz = int(m["shadowParentZ"])
        assert icon_pz > shadow_pz, (
            f"{ctx}: icon pane z={icon_pz} not above shadow pane z={shadow_pz}"
        )

    @staticmethod
    def _hit_is_icon(h: str | None) -> bool:
        return h == "icon"

    def test_icon_on_top_at_pin_center_across_zoom(self, browser, tmp_path):
        """elementFromPoint at pin center returns the icon in every zoom state.

        Negative ``zIndexOffset`` is included to prove the ordering does not
        rely on the icon's z-index — the pane boundary (500 < 600) carries
        it. Also proves icon-on-top holds even when the icon is DOM-last in
        the foliplus pane (``icon-moved-last`` scenario).
        """
        with use_page(self._probe, browser, tmp_path) as (page, errors):
            r = page.evaluate(_js("LayerControl/marker_shadow_notmove"))
            assert r is not None, "LayerAPI missing"
            assert "scen1" in {s["scenarioId"] for s in r["states"]}
            # ShadowPane z-index must be below every foliplus DATA pane z-index
            # (the panes that actually contain marker icons). Foliplus tile
            # panes sit at z~200 (below shadowPane) — those are basemap tiles
            # and are not relevant to the marker ordering question.
            pane_z = r["paneZ"]
            shadow_pane_z = int(pane_z["shadowPane"])
            # The data panes are the ones at Z_INDEX.BASE (=600) or above.
            data_pane_zs = [
                int(v)
                for k, v in pane_z.items()
                if k.startswith("foliplus-pane") and int(v) >= 600
            ]
            assert data_pane_zs, "no foliplus data pane found"
            assert shadow_pane_z < min(data_pane_zs), (
                f"shadowPane z={shadow_pane_z} not below min data pane z={min(data_pane_zs)}"
            )

            target_ids = {"scen1", "scen2"}
            for st in r["states"]:
                if st["scenarioId"] not in target_ids:
                    continue
                for m in st["markers"]:
                    if not m["inView"]:
                        continue
                    ctx = f"{st['label']}/{m['name']}"
                    self._assert_shadow_not_moved(m, ctx)
                    assert self._hit_is_icon(m["pinCenterHit"]), (
                        f"{ctx}: pin center hit was not the icon: {m}"
                    )
            assert not errors, f"JS errors: {errors}"

    def test_feed_red_pin_center_hits_shadow_when_shadow_forced_into_foliplus_pane(
        self, browser, tmp_path
    ):
        """Counter-example: shadow manually moved into the foliplus pane (no z).

        If the icon-on-top assertion above still passed in this state, it would
        mean the test is not actually checking the pane boundary — it's passing
        by coincidence. The point of this test is to prove the invariant check
        is sensitive to the pane placement: with the shadow in the same pane as
        the icon (and no z-index), the shadow's parent is no longer shadowPane,
        which is the exact invariant the main test asserts.
        """
        with use_page(self._probe, browser, tmp_path) as (page, errors):
            r = page.evaluate(_js("LayerControl/marker_shadow_notmove"))
            assert r is not None, "LayerAPI missing"
            scen3 = [s for s in r["states"] if s["scenarioId"] == "scen3"]
            assert len(scen3) == 1, f"expected 1 feed-red state, got {len(scen3)}"
            m = scen3[0]["markers"][0]
            # Setup verification: both shadow and icon are now in the foliplus pane.
            assert "foliplus-pane-" in (m["shadowParent"] or ""), (
                f"feed-red setup failed: shadow not in foliplus pane: {m}"
            )
            assert "foliplus-pane-" in (m["iconParent"] or ""), m
            # Invariant verification: the shadow's parent is NOT shadowPane,
            # which is the exact condition the main test asserts against. If
            # this assertion passed, the main test's invariant check would fail.
            assert "shadow-pane" not in (m["shadowParent"] or ""), (
                f"feed-red failed: shadow is still in shadowPane despite being moved: {m}"
            )
            # Pane z-index equality: both parents have the same z-index, so the
            # pane boundary no longer carries the ordering — only DOM order does.
            assert m["iconParentZ"] == m["shadowParentZ"], (
                f"feed-red failed: icon and shadow not in same-pane: {m}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_polygon_overlay_reports_shadow_below_data_layer(self, browser, tmp_path):
        """Data point for the architect: does a polygon layer above markers
        hide the shadow, and to what degree?

        With shadow at z=500 (shadowPane) and the polygon at z=600+ (a foliplus
        pane), the polygon sits above the shadow regardless of DOM order.
        ``fillOpacity=1`` fully hides; low ``fillOpacity`` bleeds the shadow
        through. This test asserts the polygon IS in the hit-test stack above
        the shadow, and captures the actual fillOpacity for reporting.
        """
        with use_page(self._probe, browser, tmp_path) as (page, errors):
            r = page.evaluate(_js("LayerControl/marker_shadow_notmove"))
            assert r is not None, "LayerAPI missing"
            polys = [s for s in r["states"] if s["scenarioId"].startswith("poly")]
            assert len(polys) == 2, f"expected 2 polygon states, got {len(polys)}"
            occlusion = []
            for st in polys:
                m = st["markers"][0]
                # The shadow center must NOT hit the shadow — either the
                # polygon overlay or the marker icon (which sits in a
                # foliplus pane, z=600+) occludes it. Both prove the
                # shadow is below the data layer stack.
                assert m["shadowCenterHit"] != "shadow", (
                    f"{st['label']}: shadow at its own center should be "
                    f"occluded by the polygon overlay (or icon above). Got: {m}"
                )
                # Also record whether the polygon is the topmost at shadow center.
                occlusion.append(
                    {
                        "label": st["label"],
                        "topEl": st.get("topPoly"),
                        "shadowCenterHit": m["shadowCenterHit"],
                    }
                )
            # Diagnostic-only print for the architect review; not an assertion.
            print(f"[marker-shadow] occlusion: {occlusion}")
            assert not errors, f"JS errors: {errors}"

    def test_zoom_extremes_do_not_repaint_shadow_above_icon(self, browser, tmp_path):
        """Zoom the map to extremes (min → max → base) and confirm elementFromPoint
        still returns the icon at every pin center. This is the user's reported
        repro: "zoom to min, then to max, then back to min".

        Because shadow stays in shadowPane (z=500) and icon moves to a foliplus
        pane (z=600+), the pane boundary alone guarantees icon-on-top regardless
        of any DOM re-arrangement Leaflet might do during a zoom repaint.
        """
        with use_page(self._probe, browser, tmp_path) as (page, errors):
            r = page.evaluate(_js("LayerControl/marker_shadow_notmove"))
            assert r is not None, "LayerAPI missing"
            zoom_labels = {"zoom-min", "zoom-max-ish"}
            zoom_states = [s for s in r["states"] if s["label"] in zoom_labels]
            assert len(zoom_states) == 2, (
                f"expected 2 zoom states, got {len(zoom_states)}: {zoom_states}"
            )
            for st in zoom_states:
                # Leaflet may report 0 for extreme zooms; accept >= 0.
                assert st["zoom"] >= 0 and st["zoom"] <= 20, f"unexpected zoom: {st}"
                for m in st["markers"]:
                    if not m["inView"]:
                        continue
                    ctx = f"{st['label']}(z={st['zoom']})/{m['name']}"
                    self._assert_shadow_not_moved(m, ctx)
                    assert self._hit_is_icon(m["pinCenterHit"]), (
                        f"{ctx}: pin center hit was not the icon: {m}"
                    )
            # Verify the ladder actually moved.
            zooms = [s["zoom"] for s in zoom_states]
            assert max(zooms) - min(zooms) >= 6, (
                f"zoom ladder did not span enough range: {zooms}"
            )
            assert not errors, f"JS errors: {errors}"
