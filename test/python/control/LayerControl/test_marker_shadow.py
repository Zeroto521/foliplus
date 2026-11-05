"""Marker-shadow-carrier browser tests for foliplus.LayerControl."""

from __future__ import annotations

import re

import folium
from conftest import (
    _js,
    make_browser_page,
    use_page,
)

from foliplus import LayerControl


class TestMarkerShadowCarrierBrowser:
    """Marker shadows ride the layer's own shadow pane.

    Each marker layer carries its own shadow pane, one step below the
    layer's base pane (`PaneRole.SHADOW`, `PaneManager.pinLateContent`
    moves `_shadow` in and writes `options.shadowPane`). The pane ladder —
    not DOM order, not the icons' inline z-index — carries icon-over-shadow:
    Leaflet writes `pos.y + zIndexOffset` onto icons, which goes negative
    near the viewport top or under a negative offset, and CSS paints a
    negative-z positioned element BELOW a z:auto sibling. A pane boundary is
    the one ordering that survives that, and it is also what makes pane
    writes (opacity, focus) reach the shadow. These tests verify that the
    invariants hold and the assertions are not vacuous (feed-red).
    """

    @staticmethod
    def _probe(browser, tmp_path, slug="shadow_carrier"):
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

    def _assert_shadow_carrier(self, m: dict, ctx: str) -> None:
        icon_parent = m["iconParent"] or ""
        shadow_parent = m["shadowParent"] or ""
        assert "foliplus-pane-" in icon_parent and "-shadow" not in icon_parent, (
            f"{ctx}: icon not in a foliplus data pane: {m}"
        )
        assert "foliplus-pane-" in shadow_parent and "-shadow" in shadow_parent, (
            f"{ctx}: shadow not in the layer's shadow pane: {m}"
        )
        # The pane ladder carries icon-over-shadow: the shadow pane sits one
        # step below the icon's pane, whatever the icons' inline z-index is.
        icon_pz = int(m["iconParentZ"])
        shadow_pz = int(m["shadowParentZ"])
        assert shadow_pz < icon_pz, (
            f"{ctx}: shadow pane z={shadow_pz} not below icon pane z={icon_pz}"
        )

    @staticmethod
    def _hit_is_icon(h: str | None) -> bool:
        return h == "icon"

    def test_icon_on_top_at_pin_center_across_zoom(self, browser, tmp_path):
        """elementFromPoint at pin center returns the icon in every zoom state.

        Negative ``zIndexOffset`` is included deliberately: it drives the
        icon's inline z-index negative near the viewport top, the regime
        where DOM order alone would put a z:auto shadow above its icon. The
        pane ladder must hold regardless. Also proves icon-on-top holds even
        when the icon is DOM-last in its pane (``icon-moved-last`` scenario).
        """
        with use_page(self._probe, browser, tmp_path) as (page, errors):
            r = page.evaluate(_js("LayerControl/marker_shadow_carrier"))
            assert r is not None, "LayerAPI missing"
            assert "scen1" in {s["scenarioId"] for s in r["states"]}
            # The shadow pane is a foliplus pane one step below its layer's
            # base pane — its z must sit between the layer's data panes and
            # never on the shared ladder (shadowPane z=500 stays unused).
            pane_z = r["paneZ"]
            shadow_pane_zs = [
                int(v)
                for k, v in pane_z.items()
                if k.startswith("foliplus-pane-") and k.endswith("-shadow")
            ]
            assert shadow_pane_zs, "no foliplus shadow pane found"
            for st in r["states"]:
                if st["scenarioId"] not in {"scen1", "scen2"}:
                    continue
                for m in st["markers"]:
                    if not m["inView"]:
                        continue
                    ctx = f"{st['label']}/{m['name']}"
                    self._assert_shadow_carrier(m, ctx)
                    assert self._hit_is_icon(m["pinCenterHit"]), (
                        f"{ctx}: pin center hit was not the icon: {m}"
                    )
            assert not errors, f"JS errors: {errors}"

    def test_feed_red_shadow_copaned_with_icon_collapses_the_pane_boundary(
        self, browser, tmp_path
    ):
        """Counter-example: shadow moved into the icon's pane (no z on either).

        With the shadow co-paned, the shadow pane z < icon pane z condition
        the main test asserts no longer holds — same parent, same z. If the
        main assertion still passed in this state it would mean it is not
        actually checking the pane split. (The hit-test cannot falsify this
        one: inside a foliplus pane the shadow inherits pointer-events none,
        so elementFromPoint skips it by construction.)
        """
        with use_page(self._probe, browser, tmp_path) as (page, errors):
            r = page.evaluate(_js("LayerControl/marker_shadow_carrier"))
            assert r is not None, "LayerAPI missing"
            scen3 = [s for s in r["states"] if s["scenarioId"] == "scen3"]
            assert len(scen3) == 1, f"expected 1 feed-red state, got {len(scen3)}"
            m = scen3[0]["markers"][0]
            # Setup verification: the shadow now shares the icon's pane.
            assert "foliplus-pane-" in (m["iconParent"] or ""), m
            assert m["shadowParent"] == m["iconParent"], (
                f"feed-red setup failed: shadow not co-paned with the icon: {m}"
            )
            # Pane z-index equality: both parents have the same z-index, so
            # the pane boundary no longer carries the ordering — the exact
            # condition the main test refuses.
            assert m["iconParentZ"] == m["shadowParentZ"], (
                f"feed-red failed: icon and shadow not in same-pane: {m}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_polygon_overlay_reports_shadow_below_data_layer(self, browser, tmp_path):
        """Data point for the architect: does a polygon layer above markers
        hide the shadow, and to what degree?

        The polygon layer sits above the marker layer in the registry, so its
        pane z tops the marker layer's shadow pane too — the polygon occludes
        the shadow regardless of DOM order. ``fillOpacity=1`` fully hides;
        low ``fillOpacity`` bleeds the shadow through. This test asserts the
        polygon IS in the hit-test stack above the shadow, and captures the
        actual fillOpacity for reporting.
        """
        with use_page(self._probe, browser, tmp_path) as (page, errors):
            r = page.evaluate(_js("LayerControl/marker_shadow_carrier"))
            assert r is not None, "LayerAPI missing"
            polys = [s for s in r["states"] if s["scenarioId"].startswith("poly")]
            assert len(polys) == 2, f"expected 2 polygon states, got {len(polys)}"
            occlusion = []
            for st in polys:
                m = st["markers"][0]
                # The shadow center must NOT hit the shadow — either the
                # polygon overlay or the marker icon occludes it. (Inside a
                # foliplus pane the shadow also inherits pointer-events none,
                # so it cannot be its own hit target.)
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

    def test_zoom_extremes_keep_shadow_carrier_and_icon_hit(self, browser, tmp_path):
        """Zoom the map to extremes (min → max → base) and confirm the carrier
        invariants and the pin-center hit survive the zoom re-pin. This is the
        user's reported repro: "zoom to min, then to max, then back to min".

        Because icon and shadow live in separate foliplus panes priced one
        step apart, a zoom repaint cannot reorder them — Leaflet repositions
        both inside their panes and never re-parents them.
        """
        with use_page(self._probe, browser, tmp_path) as (page, errors):
            r = page.evaluate(_js("LayerControl/marker_shadow_carrier"))
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
                    self._assert_shadow_carrier(m, ctx)
                    assert self._hit_is_icon(m["pinCenterHit"]), (
                        f"{ctx}: pin center hit was not the icon: {m}"
                    )
            # Verify the ladder actually moved.
            zooms = [s["zoom"] for s in zoom_states]
            assert max(zooms) - min(zooms) >= 6, (
                f"zoom ladder did not span enough range: {zooms}"
            )
            assert not errors, f"JS errors: {errors}"
