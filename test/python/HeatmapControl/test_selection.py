"""Browser tests for HeatmapControl layer selection and clear propagation."""

from __future__ import annotations

from conftest import _js, heatmap_ready, snippet, use_page

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
        with use_page(_make_page, browser, tmp_path, expose_ctrl=True) as (
            page,
            errors,
        ):
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

    def test_declared_layer_and_field_select_on_load(self, browser, tmp_path):
        """Python `layer=`/`field=` pick the starting source without a click."""
        with use_page(
            _make_page,
            browser,
            tmp_path,
            expose_ctrl=True,
            num_layers=3,
            layer="Points 1",
            field="val",
            agg="sum",
        ) as (page, errors):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)

            state = page.evaluate(_js("HeatmapControl/read_auto_select_state"))
            assert state["selectedLayerId"] is not None, (
                "the declared layer should be selected on load"
            )
            assert state["hasCachedFeatures"] is True, (
                "the declared layer should render without user input"
            )
            assert state["extraBodyHidden"] is False

            layer_value = page.evaluate(
                _js("HeatmapControl/read_select_value"),
                "select[data-heatmap-layer]",
            )
            field_value = page.evaluate(
                _js("HeatmapControl/read_select_value"),
                "select[data-heatmap-field-select]",
            )
            assert layer_value == state["selectedLayerId"]
            assert field_value == "val", "the declared field should be selected"

            # The declared aggregation survives the pre-scan pass: it must not
            # be downgraded to count (which would also render every cell as 1).
            agg_value = page.evaluate(
                _js("HeatmapControl/read_select_value"), "select[data-heatmap-agg]"
            )
            assert agg_value == "sum", (
                f"the declared agg should be selected: {agg_value}"
            )
            cached_agg = page.evaluate(_js("HeatmapControl/read_cached_agg"))
            assert cached_agg and "|sum|" in cached_agg["key"], (
                f"the render should aggregate by sum: {cached_agg}"
            )

            # A first open with a declaration must stay record-free: writing the
            # empty selection here would consume the hasScanned guard and make
            # the next reload skip the declaration.
            assert page.evaluate(_js("HeatmapControl/heatmap_storage_absent")), (
                "the first open wrote a record and would shadow the declaration"
            )
            assert not errors, f"JS errors: {errors}"

    def test_declared_selection_survives_reload(self, browser, tmp_path):
        """Reload without a record keeps the Python-declared starting state."""
        with use_page(
            _make_page,
            browser,
            tmp_path,
            expose_ctrl=True,
            num_layers=3,
            layer="Points 1",
            field="val",
            agg="sum",
        ) as (page, errors):
            page.reload()
            heatmap_ready(page)
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)

            state = page.evaluate(_js("HeatmapControl/read_auto_select_state"))
            assert state["selectedLayerId"] is not None, (
                "the declaration must still select a layer after a reload"
            )
            layer_value = page.evaluate(
                _js("HeatmapControl/read_select_value"),
                "select[data-heatmap-layer]",
            )
            field_value = page.evaluate(
                _js("HeatmapControl/read_select_value"),
                "select[data-heatmap-field-select]",
            )
            agg_value = page.evaluate(
                _js("HeatmapControl/read_select_value"), "select[data-heatmap-agg]"
            )
            assert layer_value == state["selectedLayerId"]
            assert field_value == "val"
            assert agg_value == "sum"
            assert page.evaluate(_js("HeatmapControl/heatmap_storage_absent")), (
                "a reload of a declared map must not have written a record"
            )
            assert not errors, f"JS errors: {errors}"

    def test_clear_restores_the_declaration_in_the_same_session(
        self, browser, tmp_path
    ):
        """Clear drops the record and re-opens the declaration, no reload needed."""
        with use_page(
            _make_page,
            browser,
            tmp_path,
            expose_ctrl=True,
            num_layers=3,
            layer="Points 1",
            field="val",
            agg="sum",
        ) as (page, errors):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)
            declared = page.evaluate(_js("HeatmapControl/read_auto_select_state"))[
                "selectedLayerId"
            ]

            page.evaluate(_js("HeatmapControl/click_clear_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-collapsed",
                state="attached",
                timeout=5000,
            )
            cleared = page.evaluate(_js("HeatmapControl/read_auto_select_state"))
            assert cleared["selectedLayerId"] is None, "Clear must drop the selection"
            assert page.evaluate(_js("HeatmapControl/heatmap_storage_absent")), (
                "Clear must delete the persisted record"
            )

            # Re-open the panel: the declaration is the starting state again.
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)
            again = page.evaluate(_js("HeatmapControl/read_auto_select_state"))
            assert again["selectedLayerId"] == declared, (
                f"the declaration should come back after Clear: {again}"
            )
            # The selection coming back is not enough: the canvas was wiped by
            # Clear, so reopening must also redraw the declared layer.
            assert again["hasCachedFeatures"] is True, (
                f"reopening after Clear must redraw the declared layer: {again}"
            )
            canvases = page.evaluate(snippet("heatmap/selection_canvas_hidden"))
            assert canvases and not all(canvases), (
                f"the heatmap canvas should be visible after Clear + reopen: {canvases}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_persisted_selection_beats_the_declaration(self, browser, tmp_path):
        """A user choice stored in a previous session wins over `layer=`."""
        with use_page(
            _make_page,
            browser,
            tmp_path,
            expose_ctrl=True,
            num_layers=3,
            layer="Points 1",
            field="val",
            agg="sum",
        ) as (page, errors):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)

            other = page.evaluate(snippet("heatmap/selection_set_persisted"))
            page.reload()
            heatmap_ready(page)

            state = page.evaluate(_js("HeatmapControl/read_auto_select_state"))
            assert state["selectedLayerId"] == other["id"], (
                "the persisted layer must beat the Python declaration"
            )
            assert not errors, f"JS errors: {errors}"
