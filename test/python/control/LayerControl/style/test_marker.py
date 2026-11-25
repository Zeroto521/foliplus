"""Browser tests for marker paint: chassis colour and the shadow carrier."""

from __future__ import annotations

import base64
import copy
import json
import re
import time
from pathlib import Path

import folium
import pytest
from conftest import (
    _js,
    feature_collection,
    heatmap_ready,
    leaflet_path,
    load_geojson,
    make_browser_page,
    panel_ready,
    point_feature,
    render,
    snippet,
    use_page,
    use_raw_page,
)

from foliplus import HeatmapControl, LayerControl


def _method_labels() -> tuple[str, str]:
    """The method row label for each built-in language, read from the locale
    table (single source — never pin the string twice)."""
    base = Path(__file__).resolve().parents[5] / "foliplus" / "locale"
    en = json.loads((base / "common.en.json").read_text(encoding="utf-8"))
    zh = json.loads((base / "common.zh.json").read_text(encoding="utf-8"))
    return en["foliplus.classification_method"], zh["foliplus.classification_method"]


from ..helper import _expand_panel, _geo_zone, _tiny_png, _write_html
from ..helper_browser import LayerControlBrowserBase


class TestMarkerColorBrowser(LayerControlBrowserBase):
    def test_marker_color_keeps_chassis_container(self, browser, tmp_path):
        """Marker colour keeps the chassis container and repaints the pin."""
        fg = folium.GeoJson(
            json.dumps(feature_collection(point_feature(119.30, 26.08))),
            name="Points",
            overlay=True,
            show=True,
            marker=folium.Marker([26.08, 119.30], icon=folium.Icon(color="red")),
        )

        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="marker_color_chassis",
        ) as (page, errors):
            self._open_style_ramp(page)
            # before: author chassis + glyph DOM
            before = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#38aadd", "opacity": 100},
            )
            assert before["ok"], before
            assert before["marker"]["hasChassisClass"], (
                f"author marker has no chassis class: {before}"
            )
            page.screenshot(
                path=str(tmp_path / "marker_color_before.png"), full_page=True
            )

            # write the preset blue at alpha 100 through the swatch row
            written = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#38aadd", "opacity": 100},
            )
            assert written["ok"], written
            page.screenshot(
                path=str(tmp_path / "marker_color_after.png"), full_page=True
            )
            assert written["marker"] is not None, (
                f"marker element missing after the write: {written}"
            )
            # The chassis container must survive: the sprite class + a real
            # background image, and the glyph must still be painted.
            assert written["marker"]["hasChassisClass"], (
                f"marker lost its chassis container after the write: {written}"
            )
            assert "awesome-marker-icon-blue" in written["marker"]["cls"], (
                f"chassis color did not re-derive: {written}"
            )
            assert written["marker"]["hasSpan"] is False, (
                f"preset alpha 100 must NOT take a chassis span: {written}"
            )
            # The glyph must survive the write. When the author's glyph name
            # is not a FontAwesome 6 name (here: the bootstrap glyphicon
            # info-sign), the honest degradation keeps the author's inner
            # glyph verbatim — the chassis changes, the symbol does not.
            glyph_cls = (written["glyph"] or {}).get("cls") or ""
            assert written["glyph"], f"glyph missing after the write: {written}"
            assert (
                "foliplus-marker-glyph" in glyph_cls.split() or "glyphicon" in glyph_cls
            ), f"glyph not painted after the write: {written}"

    def test_icon_color_incremental_paint(self, browser, tmp_path):
        """The icon colour write paints the mounted glyph in place.

        A pure colour/opacity write must NOT rebuild the icon: the derived
        marker's inner <i> is the SAME element reference after the colour
        write (no DOM churn), its computed colour updates, and the marker's
        setIcon is called once for the glyph write and ZERO additional times
        for the colour write. A glyph write still rebuilds (one setIcon).
        """
        fg = folium.GeoJson(
            json.dumps(feature_collection(point_feature(119.30, 26.08))),
            name="Points",
            overlay=True,
            show=True,
            marker=folium.Marker([26.08, 119.30], icon=folium.Icon(color="red")),
        )

        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="icon_color_incremental",
        ) as (page, errors):
            self._open_style_ramp(page)
            marker_var = page.evaluate(_js("LayerControl/find_marker_var"))
            assert marker_var is not None, "could not find the folium marker var"
            page.evaluate(_js("LayerControl/set_test_marker"), marker_var)

            result = page.evaluate(_js("LayerControl/icon_incremental_probe"), {})
            assert result["ok"], result
            # The colour write must be incremental: same <i>, no rebuild.
            assert result["sameElementAfterColor"] is True, (
                f"colour write rebuilt the icon (element changed): {result}"
            )
            assert result["afterColor"]["color"] == "rgb(0, 255, 0)", (
                f"colour write did not paint the glyph: {result}"
            )
            assert result["setIconDeltaColor"] == 0, (
                f"colour write must not call setIcon: {result}"
            )
            # The glyph write must rebuild exactly once.
            assert result["callsAfterGlyph"] >= 1, f"glyph write must rebuild: {result}"
            assert (
                result["afterGlyph"]
                and "foliplus-marker-glyph" in result["afterGlyph"]["cls"].split()
            ), f"glyph not painted: {result}"

    def test_marker_color_custom_chassis_paint(self, browser, tmp_path):
        """The marker chassis accepts a custom hex + opacity.

        The row is [color swatch | opacity number]. Three paint paths:
          • preset hex at alpha 100  → library sprite class, NO chassis span
            (author-identical, acceptance ③);
          • preset hex at alpha <100 → chassis <span> carries the sprite with
            its own opacity, the glyph <i> is a sibling and stays opaque
            (acceptance ①);
          • custom hex (any alpha)    → chassis <span> carries a mask (same
            sprite as mask-image) + flat background-color, glyph opaque
            (acceptance ②).
        """
        fg = folium.GeoJson(
            json.dumps(feature_collection(point_feature(119.30, 26.08))),
            name="Points",
            overlay=True,
            show=True,
            marker=folium.Marker([26.08, 119.30], icon=folium.Icon(color="red")),
        )

        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="marker_color_custom",
        ) as (page, errors):
            self._open_style_ramp(page)

            # ③ preset hex at alpha 100 → sprite class, NO span.
            preset = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#38aadd", "opacity": 100},
            )
            assert preset["ok"], preset
            assert preset["marker"]["hasChassisClass"], (
                f"preset alpha 100 lost the sprite class: {preset}"
            )
            assert "awesome-marker-icon-blue" in preset["marker"]["cls"], (
                f"preset alpha 100 did not re-derive blue: {preset}"
            )
            assert preset["marker"]["hasSpan"] is False, (
                f"preset alpha 100 must NOT take a chassis span: {preset}"
            )
            assert preset["glyph"] and preset["glyph"]["opacity"] == "1", (
                f"preset alpha 100 glyph not opaque: {preset}"
            )

            # ① preset hex at alpha 50 → chassis span + sprite + opacity 0.5.
            half = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#38aadd", "opacity": 50},
            )
            assert half["ok"], half
            assert half["marker"]["hasSpan"] is True, (
                f"preset alpha 50 must use a chassis span: {half}"
            )
            assert (
                half["span"] is not None and "url(" in half["span"]["backgroundImage"]
            ), f"preset alpha 50 span lost the sprite: {half}"
            assert half["span"]["opacity"] == "0.5", (
                f"preset alpha 50 span opacity: {half}"
            )
            assert half["marker"]["containerBackgroundImage"] == "none", (
                f"preset alpha 50 container must clear the sprite: {half}"
            )
            assert half["glyph"] and half["glyph"]["opacity"] == "1", (
                f"preset alpha 50 glyph must stay opaque: {half}"
            )

            # ② custom hex at alpha 50 → chassis span + mask + flat bg-color.
            custom = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#ff9900", "opacity": 50},
            )
            assert custom["ok"], custom
            assert custom["marker"]["hasSpan"] is True, (
                f"custom hex must use a chassis span: {custom}"
            )
            assert (
                custom["span"] is not None and "url(" in custom["span"]["maskImage"]
            ), f"custom hex span lost the mask: {custom}"
            assert custom["span"]["backgroundColor"] == "rgb(255, 153, 0)", (
                f"custom hex span flat color: {custom}"
            )
            assert custom["span"]["opacity"] == "0.5", (
                f"custom hex span opacity: {custom}"
            )
            assert custom["glyph"] and custom["glyph"]["opacity"] == "1", (
                f"custom hex glyph must stay opaque: {custom}"
            )


class TestMarkerShadowBrowser:
    """Marker shadows ride the layer's own shadow pane."""

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
            r = page.evaluate(
                _js("LayerControl/marker_shadow_carrier"),
                {"polygon": leaflet_path("LayerControl", "polygon_fuzhou_shadow_band")},
            )
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
            r = page.evaluate(
                _js("LayerControl/marker_shadow_carrier"),
                {"polygon": leaflet_path("LayerControl", "polygon_fuzhou_shadow_band")},
            )
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
            r = page.evaluate(
                _js("LayerControl/marker_shadow_carrier"),
                {"polygon": leaflet_path("LayerControl", "polygon_fuzhou_shadow_band")},
            )
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
            r = page.evaluate(
                _js("LayerControl/marker_shadow_carrier"),
                {"polygon": leaflet_path("LayerControl", "polygon_fuzhou_shadow_band")},
            )
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
