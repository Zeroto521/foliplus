"""Browser tests for HeatmapControl cache invalidation, EventBus-driven
renderAll flag, and degradation paths."""

from __future__ import annotations

import folium
from conftest import _js, heatmap_ready, make_browser_page, use_page

from foliplus import HeatmapControl

from .helper import _make_page, _stub_html


class TestHeatmapControlCacheBrowser:
    """Cache lifecycle: renderAll via EventBus, cachedAgg invalidation on
    layer change, and cache-clear semantics."""

    def test_render_all_flag_integration(self, browser, tmp_path):
        """renderAll is toggled via EventBus BEFORE_EXPORT / AFTER_EXPORT events."""
        with use_page(
            _make_page, browser, tmp_path, expose_ctrl=True
        ) as (page, errors):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )

            # BEFORE_EXPORT sets renderAll = true
            page.evaluate(_js("HeatmapControl/emit_export_before"))
            render_all = page.evaluate(_js("HeatmapControl/read_render_all"))
            assert render_all is True, "renderAll should be True after BEFORE_EXPORT"

            # AFTER_EXPORT resets renderAll = false
            page.evaluate(_js("HeatmapControl/emit_export_after"))
            render_all = page.evaluate(_js("HeatmapControl/read_render_all"))
            assert render_all is False, "renderAll should be False after AFTER_EXPORT"
            assert not errors, f"JS errors: {errors}"

    def test_cached_agg_invalidation_on_layer_change(self, browser, tmp_path):
        """cachedAgg is nulled when the layer changes (via onLayerChange)."""
        with use_page(
            _make_page, browser, tmp_path, expose_ctrl=True
        ) as (page, errors):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )

            # Set cachedAgg to simulate stale data
            page.evaluate(_js("HeatmapControl/seed_cached_agg_old"))
            # Emit the semantic LayerControl registry-change event on the EventBus
            # (replaces the old raw map.fire('layeradd') — the manager now
            # subscribes to LAYER_CHANGE on the per-map EventBus, and the payload
            # carries {id, kind} so the handler can filter on kind without a
            # registry walk).
            page.evaluate(_js("HeatmapControl/emit_layer_change"))
            page.wait_for_timeout(1000)
            cached = page.evaluate(_js("HeatmapControl/read_cached_agg"))
            assert cached is None, "cachedAgg should be nulled after layer change"
            assert not errors, f"JS errors: {errors}"

    def test_clear_heatmap_canvas_resets_caches(self, browser, tmp_path):
        """clearHeatmapCanvas resets all aggregation caches (but not autoFieldKey)."""
        with use_page(
            _make_page, browser, tmp_path, expose_ctrl=True
        ) as (page, errors):
            page.evaluate(_js("HeatmapControl/seed_cached_features"))
            page.evaluate(_js("HeatmapControl/seed_cached_agg_kd"))
            page.evaluate(_js("HeatmapControl/call_clear_heatmap_canvas"))
            features = page.evaluate(_js("HeatmapControl/read_cached_features"))
            agg = page.evaluate(_js("HeatmapControl/read_cached_agg"))
            assert features is None, "cachedFeatures should be nulled"
            assert agg is None, "cachedAgg should be nulled"
            assert not errors, f"JS errors: {errors}"

    def test_works_without_layercontrol(self, browser, tmp_path):
        """HeatmapControl initializes without LayerControl (degradation)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        HeatmapControl().add_to(m)

        html = m.get_root().render()
        html = _stub_html(html)
        page, errors = make_browser_page(browser, tmp_path, html, "heatmap_no_layer")
        page.wait_for_selector(
            ".foliplus-heatmap-ctrl", state="attached", timeout=10000
        )
        try:
            ctrl = page.evaluate(_js("HeatmapControl/read_heatmap_ctrl"))
            assert ctrl is not None, "HeatmapControl DOM should exist"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_canvas_pane_birth_z_is_final(self, browser, tmp_path):
        """HeatmapControl's canvas pane is born at its final z.

        Selecting a layer renders hexagons, which registers the canvas overlay
        — creating its pane and stamping its slot z in one synchronous stack.
        The prelude records the computed z one microtask after ``createPane``
        returns (the value that first frame paints), and the assertion compares
        it with the z read after an explicit ordering pass.
        """
        with use_page(
            _make_page,
            browser,
            tmp_path,
            expose_ctrl=True,
            prelude=_js("LayerControl/pane_birth_z_prelude"),
        ) as (page, errors):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)
            opts = page.evaluate(_js("HeatmapControl/read_layer_options"))
            assert opts, "No layer options found"
            page.evaluate(_js("HeatmapControl/select_layer"), opts[0])
            page.wait_for_timeout(1000)
            state = page.evaluate(_js("LayerControl/pane_birth_z_state"))
        assert state["hooked"] is True, "createPane hook never installed"
        canvas_panes = {
            name: z
            for name, z in state["panes"].items()
            if name.startswith("foliplus-canvas-")
        }
        assert canvas_panes, (
            f"heatmap canvas pane not found; panes={list(state['panes'])}"
        )
        for name, z in canvas_panes.items():
            assert z["zAtMicrotask"] != "400", (
                f"{name} painted at Leaflet's default z on the first frame: {z}"
            )
            assert z["zAtMicrotask"] == z["zAfterOrder"], (
                f"{name} moved after the ordering pass: {z}"
            )
        assert not errors, f"JS errors: {errors}"
