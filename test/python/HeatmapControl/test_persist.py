"""Browser tests for HeatmapControl localStorage persistence, reload
survival, and clear-button behavior."""

from __future__ import annotations

import json

from conftest import _js, heatmap_ready, use_page

from .helper import _make_page


class TestHeatmapControlPersistBrowser:
    """Config persistence across reload, clear-button semantics, and Clear's
    behavior against a deleted layer."""

    def test_config_persists_across_reload(self, browser, tmp_path):
        """Saved config is restored from localStorage after a reload, and the
        heatmap is re-rendered (restore path must call renderHexagons)."""
        with use_page(
            _make_page, browser, tmp_path, expose_ctrl=True, num_layers=3
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

            # Select a layer (persists via sel.onchange) and bump numClasses.
            page.evaluate(_js("HeatmapControl/select_layer"), opts[1])
            page.wait_for_timeout(500)
            page.evaluate(_js("HeatmapControl/set_num_classes_4"))
            page.evaluate(_js("HeatmapControl/save_heatmap_config"))

            stored = page.evaluate(_js("HeatmapControl/read_heatmap_storage_raw"))
            assert stored, "No heatmap storage entry written"
            saved = json.loads(stored)
            assert saved["layerId"] == opts[1]
            assert saved["numClasses"] == 4

            # Reload: applySavedConfig must restore the layer AND re-render.
            page.reload()
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl", state="attached", timeout=10000
            )
            page.wait_for_timeout(3000)

            state = page.evaluate(_js("HeatmapControl/read_heatmap_state"))
            assert state["layerId"] == opts[1], (
                f"restored layer mismatch: {state['layerId']!r} vs {opts[1]!r}"
            )
            assert state["numClasses"] == 4, (
                f"restored numClasses mismatch: {state['numClasses']!r}"
            )
            assert state["hasFeatures"] is True, (
                "heatmap should re-render after restore (cachedFeatures set)"
            )
            assert not errors, f"JS errors: {errors}"

    def test_clear_button_clears_storage(self, browser, tmp_path):
        """Clear button wipes localStorage so a reload does NOT restore the
        previously saved config (returns to Python defaults)."""
        with use_page(
            _make_page, browser, tmp_path, expose_ctrl=True, num_layers=3
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
            # Select a layer (persists via sel.onchange) so storage is non-empty.
            page.evaluate(_js("HeatmapControl/select_layer"), opts[0])
            page.wait_for_timeout(500)

            stored = page.evaluate(_js("HeatmapControl/read_heatmap_storage_raw"))
            assert stored, "Expected a stored config before clearing"

            page.evaluate(_js("HeatmapControl/click_clear_button"))
            page.wait_for_timeout(500)

            gone = page.evaluate(_js("HeatmapControl/heatmap_storage_absent"))
            assert gone, "Clear button must remove the saved config from localStorage"

            # Reload: with no saved config, multi-layer page must NOT auto-select
            # or render (defaults apply).
            page.reload()
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl", state="attached", timeout=10000
            )
            page.wait_for_timeout(3000)
            state = page.evaluate(_js("HeatmapControl/read_heatmap_state"))
            assert state["layerId"] is None, (
                f"cleared config must not restore a layer, got {state['layerId']!r}"
            )
            assert state["numClasses"] == 6, (
                f"cleared config must keep Python default, got {state['numClasses']!r}"
            )
            assert state["hasFeatures"] is False, (
                "no layer selected after clear, so no render expected"
            )
            assert not errors, f"JS errors: {errors}"

    def test_delete_layer_does_not_resurrect_on_reload(self, browser, tmp_path):
        """Deleting the heatmap's own layer in LayerControl's more menu
        persists an empty selection, so a reload does not auto-select the
        single point layer and re-render the very heatmap the user deleted.

        Two independent segments: the deletion clears the live page, and the
        empty selection written to localStorage is what keeps a reload from
        resurrecting it.
        """
        with use_page(
            _make_page, browser, tmp_path, expose_ctrl=True, num_layers=1
        ) as (page, errors):
            heatmap_ready(page)

            # One point layer: initScan's one-shot auto-select fired, the heatmap
            # drew its canvas and registered it with LayerControl.
            pre = page.evaluate(_js("HeatmapControl/read_heatmap_pre_delete_state"))
            assert pre["selected"] is not None, "single layer must auto-select"
            assert pre["hasFeatures"] is True, "auto-select must have rendered"
            assert pre["registered"] is True, "heatmap canvas must be registered"

            # Delete the heatmap's own layer from LayerControl's more menu.
            removed = page.evaluate(_js("HeatmapControl/delete_heatmap_layer"))
            assert removed == 1, (
                f"expected the heatmap layer deleted, removed {removed}"
            )

            page.evaluate(_js("HeatmapControl/flush_heatmap_config"))

            # Segment 1 — the delete clears the live page immediately, and the
            # empty selection is PERSISTED (a record with layerId: null) rather
            # than dropped. That persisted record is the whole point.
            seg1 = page.evaluate(_js("HeatmapControl/read_heatmap_storage_with_layer"))
            assert seg1["selected"] is None, "delete must clear the selection"
            assert seg1["hasFeatures"] is False, "delete must clear the heatmap data"
            assert seg1["rows"] == pre["rows"] - 1, (
                f"heatmap row must be gone, rows {seg1['rows']} vs {pre['rows']}"
            )
            assert seg1["recordPresent"] is True, (
                "deleting the layer must persist the empty selection, not drop "
                "the record"
            )
            assert seg1["storedLayerId"] is None, (
                f"persisted record must carry a cleared selection, "
                f"got {seg1['storedLayerId']!r}"
            )

            # Segment 2 — reload. The persisted empty selection consumes the
            # one-shot auto-select guard, so the deleted heatmap stays deleted.
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl", state="attached", timeout=10000
            )
            heatmap_ready(page)
            seg2 = page.evaluate(_js("HeatmapControl/read_heatmap_layer_state"))
            assert seg2["selected"] is None, (
                f"deleted heatmap must not re-select itself on reload, "
                f"got {seg2['selected']!r}"
            )
            assert seg2["hasFeatures"] is False, (
                "deleted heatmap must not re-render after a reload"
            )
            assert seg2["rows"] == seg1["rows"], (
                f"reload must not re-register the heatmap canvas, rows "
                f"{seg2['rows']} vs {seg1['rows']}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_ui_control_changes_persist(self, browser, tmp_path):
        """Style controls (agg/method/scheme) write to localStorage
        on change, not just the layer select."""
        with use_page(
            _make_page, browser, tmp_path, expose_ctrl=True, num_layers=1
        ) as (page, errors):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)

            def stored():
                return page.evaluate(_js("HeatmapControl/read_heatmap_storage_parsed"))

            # agg select
            page.evaluate(
                _js("HeatmapControl/set_ctrl_select_and_change"),
                ["aggSelect", "sum"],
            )
            page.wait_for_timeout(300)
            assert stored()["agg"] == "sum", "agg change must persist"

            # classification method
            page.evaluate(
                _js("HeatmapControl/set_ctrl_select_and_change"),
                ["methodSelect", "quantile"],
            )
            page.wait_for_timeout(300)
            assert stored()["method"] == "quantile", "method change must persist"

            # scheme (hidden select fires persist onchange)
            page.evaluate(
                _js("HeatmapControl/set_ctrl_select_and_change"),
                ["schemeSelectHidden", "Blues"],
            )
            page.wait_for_timeout(300)
            assert stored()["scheme"] == "Blues", "scheme change must persist"

            assert not errors, f"JS errors: {errors}"

    def test_clear_all_removes_content(self, browser, tmp_path):
        """clearHeatmapCanvas() clears cached data and hides the overlay."""
        with use_page(
            _make_page, browser, tmp_path, expose_ctrl=True
        ) as (page, errors):
            # Render some content first
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)
            opts = page.evaluate(_js("HeatmapControl/read_layer_options"))
            if opts:
                page.evaluate(_js("HeatmapControl/select_layer"), opts[0])
                page.wait_for_timeout(2000)

            # Call clearHeatmapCanvas
            page.evaluate(_js("HeatmapControl/call_clear_heatmap_canvas"))
            page.wait_for_timeout(500)

            cached_gone = page.evaluate(_js("HeatmapControl/read_cached_features_null"))
            canvas_gone = page.evaluate(_js("HeatmapControl/read_canvas_hidden_class"))
            assert cached_gone, "cachedFeatures should be null after clear"
            assert canvas_gone, "Canvas should be hidden after clear"
            assert not errors, f"JS errors: {errors}"

    def test_clear_button_works(self, browser, tmp_path):
        """Pressing the clear button resets all controls and clears layers."""
        with use_page(
            _make_page, browser, tmp_path, expose_ctrl=True
        ) as (page, errors):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)

            # Change some values
            page.evaluate(_js("HeatmapControl/set_num_classes_4"))
            # Click clear
            page.evaluate(_js("HeatmapControl/click_clear_button"))
            page.wait_for_timeout(500)

            mgr = page.evaluate(_js("HeatmapControl/read_manager_state"))
            assert mgr["numClasses"] == 6, f"expected 6 got {mgr['numClasses']}"
            assert mgr["borderWeight"] == 1.5
            assert mgr["method"] == "jenks"
            assert not errors, f"JS errors: {errors}"
