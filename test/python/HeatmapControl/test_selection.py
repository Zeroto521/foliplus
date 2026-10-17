"""Browser tests for HeatmapControl layer selection and clear propagation."""

from __future__ import annotations

from conftest import _js, heatmap_ready, use_page

from .helper import _make_page


class TestHeatmapControlSelectionBrowser:
    """Layer auto-select on panel expand, and Clear's propagation to
    LayerControl's record."""

    def test_auto_select_single_layer(self, browser, tmp_path):
        """Single point layer is auto-selected on panel expand."""
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

            state = page.evaluate(_js("HeatmapControl/read_auto_select_state"))
            assert state["selectedLayerId"] is not None, "Layer should be auto-selected"
            assert state["hasCachedFeatures"] is True, (
                "renderHexagons should have been called"
            )
            assert state["extraBodyHidden"] is False, (
                "Extra body should be visible after auto-select"
            )
            assert not errors, f"JS errors: {errors}"

    def test_auto_select_skipped_for_multiple_layers(self, browser, tmp_path):
        """Multiple point layers: auto-select does NOT trigger."""
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

            state = page.evaluate(_js("HeatmapControl/read_auto_select_state"))
            assert state["selectedLayerId"] is None, (
                "No layer should be auto-selected with multiple layers"
            )
            assert state["hasCachedFeatures"] is False, (
                "renderHexagons should NOT have been auto-called"
            )
            assert state["extraBodyHidden"] is True, (
                "Extra body should stay hidden without auto-select"
            )
            assert not errors, f"JS errors: {errors}"

    def test_panel_interaction(self, browser, tmp_path):
        """Open heatmap panel, verify layer dropdown populates."""
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

            options_count = page.evaluate(_js("HeatmapControl/read_layer_option_count"))
            assert options_count >= 2

            page.evaluate(_js("HeatmapControl/click_close_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-collapsed",
                state="attached",
                timeout=5000,
            )

            assert not errors, f"JS errors: {errors}"

    def test_clear_drops_layercontrol_state_panel_and_menu(self, browser, tmp_path):
        """Both clear entries erase LayerControl's record; a redraw is fresh.

        The heatmap's own config key and LayerControl's key are separate, so a
        redraw of the same id inherited the opacity and visibility the user had
        arranged for the previous draw -- and a plain reload resurrected them
        as well. The panel's Clear button and the row menu's Clear Data must
        each drop their half.
        """
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

            result = page.evaluate(_js("HeatmapControl/clear_drops_layer_state"))
            assert not result.get("error"), f"probe failed: {result}"

            for label in ("clearButton", "menuDelete"):
                r = result[label]
                assert r["tuning"] == "ok", f"{label}: tuning did not apply: {r}"
                assert r["ran"], f"{label}: the clear action did not run: {r}"

                # The user's tuning reached LayerControl's record...
                assert r["afterSet"]["visible"] is False, (
                    f"{label}: the checkbox write did not persist: {r}"
                )
                assert r["afterSet"]["opacity"] == 0.35, (
                    f"{label}: the slider write did not persist: {r}"
                )
                assert set(r["afterSet"]["overrides"]) == {"opacity", "visible"}, (
                    f"{label}: unexpected provenance: {r}"
                )

                # ...and the clear dropped it, then a redraw came back clean.
                assert r["afterClear"] is None, (
                    f"{label}: the clear left LayerControl's record behind: {r}"
                )
                assert r["afterRedraw"] is None, (
                    f"{label}: a redraw inherited the previous draw's state: {r}"
                )
                assert r["checkboxAfterRedraw"] is True, (
                    f"{label}: the redraw did not come back at the author default: {r}"
                )

            assert not errors, f"JS errors: {errors}"
