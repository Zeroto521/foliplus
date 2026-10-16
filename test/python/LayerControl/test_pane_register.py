"""Pane-probe browser tests for foliplus.LayerControl."""

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

from .helper import _expand_panel, _geo_mixed, _tiny_png, _write_html

# ── pane-surface probe ─────────────────────────────────────────────────
#
# Test-only suite: measures the four facts the LayerSurface refactor (R3+)
# relies on, against the real Leaflet/folium DOM. No product code is
# changed here. Each method locks in a *measured* behavior so a later
# Leaflet/folium/plugin upgrade that invalidates a design assumption
# surfaces as a test failure instead of a silent regression.
#
# The four facts per probe:
#   1. where the content actually lives (pane name; shared or per-layer)
#   2. whether CSS opacity written to that pane reaches the content
#   3. whether DOM created at runtime inherits the same pane
#   4. whether the layer's native setter is effective immediately
#
# `probe_pane_facts.js` is the shared harness; the other `probe_*.js`
# snippets cover cases the harness cannot (heat canvas, cluster icon,
# color basemap, mixed renderer, tile maxZoom refresh).


class TestLayerPaneRegisterBrowser:
    """Pane-surface probe — measured pane-surface facts."""

    @staticmethod
    def _probe(browser, tmp_path, *layers, slug="probe"):
        """Render a default folium map (OSM base → finite maxZoom, so
        MarkerCluster initializes) with LayerControl + *layers, exposing
        ``window.__layerCtrl`` for the probe snippets."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        for layer in layers:
            layer.add_to(m)
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

    @staticmethod
    def _facts(page, spec: dict) -> dict:
        page.evaluate(f"window.__probe = {json.dumps(spec)}")
        return page.evaluate(_js("LayerControl/probe_pane_facts"))

    # ── R3: materialize at registration (I1 / I2) ──────────────────

    def test_register_materializes_pane_before_add(self, browser, tmp_path):
        """I1: after ``registerLayer`` returns — and *before* any ordering pass —
        the content already sits in the layer's own pane.

        The probe deliberately calls no ``enforceOrder``: the claim is that the
        pane is decided before the layer joins the map, not that a later pass
        moves it there. Every other pane probe has to force the pass first
        precisely because that used to be the only moment the pane was set.
        """
        with use_page(self._probe, browser, tmp_path, slug="p_immediate") as (
            page,
            errors,
        ):
            r = page.evaluate(_js("LayerControl/register_immediate_pane"))
        assert r is not None, "LayerAPI missing"
        assert len(r["declared"]) == 1, r
        pane = r["declared"][0]
        assert pane.startswith("foliplus-pane-"), r
        assert r["iconPane"] == pane, r
        assert r["pathPane"] == pane, r
        assert r["shared"] is False, r
        assert r["leafPaneSet"] is True, r
        assert not errors, f"JS errors: {errors}"

    def test_register_rebuilds_surface_for_same_container(self, browser, tmp_path):
        """I2: re-registering the same container keeps one pane set, and content
        added in between lands in it too."""
        with use_page(self._probe, browser, tmp_path, slug="p_rebuild") as (
            page,
            errors,
        ):
            r = page.evaluate(_js("LayerControl/register_rebuilds_surface"))
        assert r is not None, "LayerAPI missing"
        assert len(r["before"]) == 1, r
        assert r["before"][0].startswith("foliplus-pane-"), r
        # The pane set did not change across the re-registration...
        assert r["after"] == r["before"], r
        # ...and both markers render into it: the one from before, and the one
        # added just before the re-registration.
        assert r["firstMarkerPane"] == r["before"][0], r
        assert r["secondMarkerPane"] == r["before"][0], r
        assert r["rowCount"] == 1, r
        assert not errors, f"JS errors: {errors}"

    # ── overlay / plugin probes ──────────────────────────────────

    def test_probe_geojson_mixed_geometry(self, browser, tmp_path):
        """#1 GeoJson: point → marker, line/polygon → path, all in one pane."""
        geo = folium.GeoJson(_geo_mixed, name="Probe GeoJson")
        with use_page(self._probe, browser, tmp_path, geo, slug="p1") as (page, _):
            r = self._facts(
                page,
                {
                    "id": geo.get_name(),
                    "add": "geojson-addpoint",
                    "native": "path-setstyle",
                },
            )
        assert r["homes"], "GeoJson leaves should have DOM elements"
        assert all(h["pane"].startswith("foliplus-pane-") for h in r["homes"])
        assert not any(h["shared"] for h in r["homes"])
        assert r["css"]["reached"] and not r["css"]["shared"]
        assert r["runtime"]["reached"] and not r["runtime"]["shared"]
        assert r["native"]["attr"] == "0.4"  # setStyle immediate on paths

    def test_probe_standalone_marker_unregistered(self, browser, tmp_path):
        """#2 folium.Marker (+ Icon): not a folium Layer, so never registered
        — its divIcon stays in the shared markerPane; setOpacity is the
        only per-marker lever."""
        m1 = folium.Marker([26.08, 119.30], name="M1", icon=folium.Icon(color="red"))
        m2 = folium.Marker(
            [26.06, 119.28],
            name="M2",
            icon=folium.Icon(color="blue", icon="info-sign", prefix="fa"),
        )
        with use_page(self._probe, browser, tmp_path, m1, m2, slug="p2") as (
            page,
            _,
        ):
            r1 = self._facts(
                page, {"layerVar": m1.get_name(), "native": "marker-setopacity"}
            )
            r2 = self._facts(page, {"layerVar": m2.get_name()})
        for r in (r1, r2):
            assert r["homes"][0]["pane"] == "markerPane"
            assert r["homes"][0]["shared"] is True
            assert r["css"]["shared"] is True  # would fade every marker
        assert r1["native"]["eff"] == 0.4  # setOpacity immediate

    def test_probe_marker_cluster_leaves(self, browser, tmp_path):
        """#3 MarkerCluster: individual marker icons migrate to a per-layer
        pane; runtime-added markers inherit it (after enforceOrder)."""
        from folium.plugins import MarkerCluster

        mc = MarkerCluster(name="Probe Cluster")
        for lat, lng in ([26.10, 119.25], [26.12, 119.27], [26.14, 119.29]):
            folium.Marker([lat, lng], name="c").add_to(mc)
        with use_page(self._probe, browser, tmp_path, mc, slug="p3") as (page, _):
            r = self._facts(page, {"id": mc.get_name(), "add": "cluster-addmarker"})
        assert r["homes"][0]["pane"].startswith("foliplus-pane-")
        assert not r["homes"][0]["shared"]
        assert r["css"]["reached"] and not r["css"]["shared"]
        assert r["runtime"]["reached"] and not r["runtime"]["shared"]

    def test_probe_marker_cluster_icon_shared(self, browser, tmp_path):
        """#3 (cluster icon): the ``.marker-cluster`` icon is NOT reached by
        pinLateContent's eachLayer recursion, so it stays in markerPane."""
        from folium.plugins import MarkerCluster

        mc = MarkerCluster(name="Probe Cluster")
        # Two markers at the same spot force a cluster icon at any zoom.
        folium.Marker([26.10, 119.25], name="a").add_to(mc)
        folium.Marker([26.10, 119.25], name="b").add_to(mc)
        with use_page(self._probe, browser, tmp_path, mc, slug="p3icon") as (
            page,
            _,
        ):
            r = page.evaluate(_js("LayerControl/probe_cluster_icon"))
        assert r["iconCount"] >= 1
        assert r["iconPanes"] and all(p == "markerPane" for p in r["iconPanes"])

    def test_probe_heat_canvas_overlay_pane(self, browser, tmp_path):
        """#4 HeatMap: leaflet-heat appends its canvas to overlayPane; the
        fallback pane enforceOrder assigns is never moved into, so a
        per-layer pane carrier does NOT reach it today (shared pane)."""
        from folium.plugins import HeatMap

        heat = HeatMap([[26.08, 119.30, 1.0]], name="Probe Heat")
        with use_page(self._probe, browser, tmp_path, heat, slug="p4") as (
            page,
            _,
        ):
            page.evaluate(f"window.__probe = {json.dumps({'id': heat.get_name()})}")
            r = page.evaluate(_js("LayerControl/probe_heat_canvas"))
        assert r["found"] is True
        assert r["pane"] == "overlayPane"
        assert r["shared"] is True
        assert r["reached"] is True  # via the shared overlayPane only
        assert r["setOptions"] == "function"  # minOpacity settable at runtime

    def test_probe_image_overlay_overlay_pane(self, browser, tmp_path):
        """#5 ImageOverlay: ``<img>`` stays in overlayPane (pinLateContent
        only moves Path elements + Marker icons); setOpacity is immediate."""
        from folium.raster_layers import ImageOverlay

        img = ImageOverlay(_tiny_png, [[26.0, 119.2], [26.2, 119.4]], name="Img")
        with use_page(self._probe, browser, tmp_path, img, slug="p5") as (
            page,
            _,
        ):
            r = self._facts(page, {"id": img.get_name(), "native": "img-setopacity"})
        assert r["homes"][0]["pane"] == "overlayPane"
        assert r["homes"][0]["shared"] is True
        assert r["css"]["shared"] is True  # would fade all overlay content
        assert r["native"]["eff"] == 0.4  # setOpacity immediate on the <img>

    def test_probe_third_party_featuregroup_unregistered(self, browser, tmp_path):
        """#6 A third-party L.FeatureGroup added directly (no styleSetters,
        not registered) splits across overlayPane/markerPane — both shared."""
        with use_page(self._probe, browser, tmp_path, slug="p6a") as (page, _):
            r = self._facts(page, {"build": "featuregroup"})
        panes = {h["pane"] for h in r["homes"]}
        assert "overlayPane" in panes and "markerPane" in panes
        assert all(h["shared"] for h in r["homes"])

    def test_probe_third_party_featuregroup_registered(self, browser, tmp_path):
        """#6 (registered via LayerAPI): everything migrates into a
        per-layer fallback pane; runtime-added markers inherit it. This is
        the C-tier contract — register to get the pane carrier."""
        with use_page(self._probe, browser, tmp_path, slug="p6b") as (page, _):
            page.evaluate(
                """() => {
                  const api = window.map.foliplus.LayerAPI;
                  const fg = L.featureGroup([
                    L.polygon([[26.30, 119.20], [26.34, 119.20], [26.32, 119.25]]),
                    L.marker([26.33, 119.23]),
                  ]);
                  fg.addTo(window.map);
                  api.registerLayer({ id: '__tp_fg__', name: 'TP FG', layer: fg });
                  return true;
                }"""
            )
            r = self._facts(page, {"id": "__tp_fg__", "add": "group-addmarker"})
        assert all(h["pane"].startswith("foliplus-pane-") for h in r["homes"])
        assert not any(h["shared"] for h in r["homes"])
        assert r["css"]["reached"] and not r["css"]["shared"]
        assert r["runtime"]["reached"] and not r["runtime"]["shared"]

    # ── base + mixed renderer probes ────────────────────────────────

    def test_probe_two_tilelayers_native_opacity(self, browser, tmp_path):
        """#7 Two TileLayers share tilePane; setOpacity on one container
        leaves the sibling opaque — direct evidence for "底图走原生 setOpacity,
        永不用 pane 载体"."""
        t1 = folium.TileLayer("OpenStreetMap", name="Probe OSM")
        t2 = folium.TileLayer("CartoDB positron", name="Probe Carto")
        with use_page(self._probe, browser, tmp_path, t1, t2, slug="p7") as (
            page,
            _,
        ):
            r = self._facts(page, {"id": t1.get_name(), "native": "tile-setopacity"})
            sibling = page.evaluate(
                """([idA, idB]) => {
                  const m = window.__layerCtrl.mgr;
                  const a = m.findLayer(m.layers.find(l => l.id === idA));
                  const b = m.findLayer(m.layers.find(l => l.id === idB));
                  a.setOpacity(0.4);
                  const effA = getComputedStyle(a._container).opacity;
                  const effB = getComputedStyle(b._container).opacity;
                  a.setOpacity(1);
                  return { effA, effB };
                }""",
                [t1.get_name(), t2.get_name()],
            )
        assert r["native"]["eff"] == 0.4
        assert sibling["effA"] == "0.4" and sibling["effB"] == "1"

    def test_probe_tile_maxzoom_needs_refresh(self, browser, tmp_path):
        """#8 options.maxZoom change does NOT take effect immediately nor via
        ``_updateLevels()`` alone; only ``_resetView()``/``redraw()`` clears
        the now-out-of-range tiles. R8's native path must call redraw."""
        t1 = folium.TileLayer("OpenStreetMap", name="Probe OSM")
        with use_page(self._probe, browser, tmp_path, t1, slug="p8") as (
            page,
            _,
        ):
            page.evaluate(f"window.__probe = {json.dumps({'id': t1.get_name()})}")
            r = page.evaluate(_js("LayerControl/probe_tile_maxzoom"))
        assert r["before"] > 0
        assert r["afterSet"] == r["before"]  # no immediate effect
        assert r["afterLevels"] == r["before"]  # _updateLevels alone insufficient
        assert r["afterReset"] == 0  # redraw clears out-of-range tiles

    def test_probe_color_basemap_no_pane(self, browser, tmp_path):
        """#9 Solid-color basemap owns a dedicated pane + canvas — the old
        container-CSS-background contract (--color-layer-bg) is retired.
        Under basemap coexistence the retired `foliplus-layer-tile-hidden` gate
        is gone: the tile pane stays visible underneath, the color paints in its own pane."""
        with use_page(
            self._probe,
            browser,
            tmp_path,
            folium.TileLayer("OpenStreetMap", name="Probe OSM"),
            slug="p9",
        ) as (page, _):
            r = page.evaluate(_js("LayerControl/probe_color_basemap"))
        assert r["itemFound"] is True
        assert r["itemActive"] is True, "color item should be active"
        assert r["colorPaneFound"] is True, "color pane must exist after show"
        assert r["colorVisible"] is True, "color pane face must be visible"
        # Basemap coexistence: the shared tilePane is not hidden by the color basemap.
        assert r["tileHidden"] is False
        assert r["tileVisibility"] == "visible"
        # No foliplus pane is the "tile-hidden" contract — nothing under
        # Basemap coexistence carries that class. (Registered TileLayers get their own
        # synthesized foliplus-pane-*, which is a different marker.)
        assert not any("tile-hidden" in c for c in r["foliplusPanes"])

    def test_probe_mixed_renderer_pane_consistent(self, browser, tmp_path):
        """#10 SVG data pane + canvas label pane: pane-level opacity hits
        both renderers; hiding/pointer-events:none on the label pane keeps
        the SVG data clickable underneath."""
        with use_page(self._probe, browser, tmp_path, slug="p10") as (page, _):
            r = page.evaluate(_js("LayerControl/probe_mixed_renderer"))
        assert r["pathPane"] == "__probe_mixed_data__"
        assert r["labelCanvasPane"] == "__probe_mixed_label__"
        assert abs(r["pathEff"] - 0.4) < 0.02
        assert abs(r["canvasEff"] - 0.4) < 0.02

    def test_hatch_fullscreen_parity(self, browser, tmp_path):
        """No-basemap hatch keeps the same paint inside and outside fullscreen.

        The failure mode is an *absent opaque background*: with
        ``background-color: transparent`` the container shows the page behind it
        normally, but in fullscreen it shows the UA ``::backdrop`` (black) —
        "white + grid" outside, "black + grid" inside. The backdrop itself is
        not observable (``getComputedStyle`` describes the element; headless
        Chromium does not composite the backdrop into a screenshot), so the
        decisive assertion is that the container paints an opaque, light
        background — that is what keeps the backdrop invisible. Parity of the
        element's own paint across the fullscreen transition is asserted too.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        _expand_panel(m)
        html_path = tmp_path / "test_hatch_parity.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            # Arm the empty-basemap state and mount the fullscreen trigger.
            page.evaluate("window.__probe = { action: 'arm' }")
            armed = page.evaluate(_js("LayerControl/hatch_fullscreen_parity"))
            assert armed["ok"] is True, armed
            before = armed["state"]
            assert before["isFull"] is False, "read must start outside fullscreen"
            assert before["hatch"] is True, f"hatch missing before fullscreen: {before}"

            # The container must paint an opaque background: a transparent one
            # is exactly what lets the black backdrop show through in
            # fullscreen. Lightness keeps it the intended light-base hatch.
            rgba = before["rgba"]
            assert rgba is not None, f"unreadable background colour: {before}"
            assert rgba["a"] == 1, (
                f"no-basemap hatch must paint an opaque background, got {before['bg']}"
            )
            luma = (rgba["r"] + rgba["g"] + rgba["b"]) / 3
            assert luma > 128, f"hatch background must stay light, got {before['bg']}"

            # A real click is what grants the user activation the API requires.
            page.click("#foliplus-fs-trigger")
            page.wait_for_timeout(500)

            after = page.evaluate(_js("LayerControl/hatch_fullscreen_parity"))
            assert after["ok"] is True, after
            state = after["state"]
            assert state["isFull"] is True, (
                f"requestFullscreen did not take effect: {state}"
            )

            # Entering fullscreen must not change the element's own paint.
            assert state["bg"] == before["bg"], (
                f"background differs across fullscreen: {before['bg']} -> {state['bg']}"
            )
            assert state["hatch"] is True, f"hatch lost in fullscreen: {state}"
