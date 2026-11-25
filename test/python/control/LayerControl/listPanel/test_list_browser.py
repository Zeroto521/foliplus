"""Browser tests: the layer list's registry-level contract.

The list is a read-only view over the registry: unregister removes a layer,
direct array mutation throws, dynamic registration inserts one item instead of
rebuilding the list, and toggling stays inside its latency budget. The leak
probe is the control group for the listener-drift gate.
"""

from __future__ import annotations

import folium
from conftest import _js, leaflet_path, panel_ready, use_page

from ..helper_browser import LayerControlBrowserBase


class TestListBrowser(LayerControlBrowserBase):
    def test_probe_leak_listener_control_group_grows(self, browser, tmp_path):
        """A single bare map.on() must register as a +1 in the listener sum.

        Control group for the drift gate above: if this control fails, the
        sumMapEvents measure is measuring nothing and the drift assertion
        in test_remove_readd_leaves_no_listener_residue has no teeth.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/probe_leak_listener"))
            assert result["delta"] > 0, (
                f"Leak control group: expected a positive delta, got {result!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_unregister_layer_in_browser(self, browser, tmp_path):
        """unregisterLayer removes a dynamically registered layer."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/unregister_layer_flow"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
            assert result is not None
            assert result["before"] is True
            assert result["after"] is False

    def test_layers_view_is_readonly(self, browser, tmp_path):
        """api.layers is a read-only view — direct mutation is blocked.

        External callers must go through LayerAPI (registerLayer/unregisterLayer
        etc.) so the registry index can never be bypassed or drift from the list.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/layers_view_readonly"))
            assert result is not None, "LayerAPI not found"
            assert result["length"] > 0, "read length failed"
            assert result["firstId"], "read index failed"
            assert result["mapped"] == result["length"], "read map failed"
            assert result["pushThrew"] is True, "push should throw"
            assert result["spliceThrew"] is True, "splice should throw"
            assert result["assignThrew"] is True, "index assign should throw"
            assert result["shiftThrew"] is True, "shift should throw"

    def test_drag_reorder_syncs_panel_rows(self, browser, tmp_path):
        """A plain registry reorder must re-align the panel's row order.

        The bug class this guards: reorderLayer / bringToFront /
        moveUp / moveDown repriced z from the registry but never wrote the
        persisted block order, so the panel rows kept the old sequence while
        the map's stacking order changed. The layout is seeded with the folder
        key + both roots LISTED (the stale-order precondition), a real drop is
        driven through onDrop, and the panel rows must then equal the registry.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("LayerControl/seed_layout_order"))
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl",
                state="attached",
                timeout=10000,
            )
            result = page.evaluate(_js("LayerControl/drag_roworder_sync"))
            assert result is not None, "drag_roworder_sync failed"
            assert result["zOrderChanged"] is True, (
                f"drop did not change the registry: {result!r}"
            )
            assert result["panelMatchesRegistry"] is True, (
                f"panel rows diverged from registry: {result!r}"
            )
            assert not errors, f"JS errors: {errors}"


class TestListPerformanceBrowser(LayerControlBrowserBase):
    def test_render_initial_list_incremental(self, browser, tmp_path):
        """registerLayer on an existing UI must not rebuild the whole list.

        renderInitialList currently wipes innerHTML and re-creates every item,
        which is O(n) per registration (O(n^2) for n registrations). A
        registered layer should insert a single DOM item instead.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/render_initial_list_incremental"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
            assert result is not None, "LayerAPI not found"
            # After the initial attachUI render (1 call), dynamic registrations
            # must not trigger additional full rebuilds.
            assert result["afterSecond"] <= 1, (
                f"registerLayer triggered full rebuilds: {result['afterSecond']}"
            )

    def test_toggle_performance(self, browser, tmp_path):
        """Layer toggle and toggle-all operations complete within 100ms."""
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay1, overlay2) as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)
            results = page.evaluate(_js("LayerControl/performance_toggle"))
            assert results is not None, "performance_toggle failed"
            for r in results:
                assert r["ms"] < 100, f"{r['op']} took {r['ms']}ms (threshold: 100ms)"
