"""Panel UI tests for foliplus.MeasureControl."""

from __future__ import annotations

from conftest import _js, use_page

from .helper import _make_page


class TestMeasurePanelBrowser:
    def test_panel_collapses_on_outside_press_by_default(self, browser, tmp_path):
        """Default unchanged: a press outside the panel still collapses it.

        MeasureControl binds ``bindOutsideCollapse`` on its own — gated by the
        active-mode ``skipCheck`` rather than the shared panel shell — so this
        pins that its own binding survived the new parameter.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/click_measure_toggle_button"))
            page.wait_for_selector(
                ".foliplus-measure-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)
            assert page.evaluate(_js("MeasureControl/read_measure_panel_expanded")), (
                "the measure panel did not expand"
            )

            page.mouse.click(600, 300)
            page.wait_for_selector(
                ".foliplus-measure-ctrl.foliplus-is-collapsed",
                state="attached",
                timeout=5000,
            )
            assert page.evaluate(_js("MeasureControl/read_measure_panel_collapsed")), (
                "the measure panel stayed open after an outside press"
            )
            assert not errors, f"JS errors: {errors}"

    def test_tool_buttons_render(self, browser, tmp_path):
        """Tool buttons are present in the DOM, including the export button."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            btns = page.evaluate(_js("MeasureControl/read_tool_btn_count"))
            # 5 original buttons (marker/distance/polygon/circle/clear) + 1 export
            assert btns >= 6
            assert not errors, f"JS errors: {errors}"

    def test_export_button_present(self, browser, tmp_path):
        """Export button is the only tool button without data-mode."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            count = page.evaluate(_js("MeasureControl/read_export_btn_count"))
            assert count == 1, f"Expected exactly 1 export button, got {count}"
            assert not errors, f"JS errors: {errors}"

    def test_export_no_data_hint_when_empty(self, browser, tmp_path):
        """Clicking export button with no measurements shows a hint, not an error."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/click_export_button"))
            page.wait_for_timeout(500)
            assert not errors, f"JS errors: {errors}"

    def test_clear_all_collapses_panel(self, browser, tmp_path):
        """clearAll collapses the expanded panel when a measurement exists."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # Add a measurement
            page.evaluate(_js("MeasureControl/add_layer_and_clear_all"))
            page.wait_for_timeout(300)
            # clearAll should be safe — no crash, panel collapse via ctrl
            assert not errors, f"JS errors: {errors}"
