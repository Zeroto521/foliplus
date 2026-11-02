"""Browser tests for HeatmapControl panel state: outside-press behavior and
default-value initialization."""

from __future__ import annotations

import pytest
from conftest import _js, heatmap_ready, use_page

from .helper import _make_page, _panel_open


class TestHeatmapControlPanelBrowser:
    """Panel open/collapse behavior and initial state."""

    def test_panel_collapses_on_outside_press_by_default(self, browser, tmp_path):
        """Default unchanged: a press outside the panel still collapses it.

        Regression gate for ``collapse_on_outside``. HeatmapControl shares
        ``createPanelControl`` with LayerControl, so the shell option must keep
        its historic behavior for any caller that does not opt out — and only
        LayerControl passes ``false``.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)
            assert _panel_open(page)

            page.mouse.click(900, 450)
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-collapsed",
                state="attached",
                timeout=5000,
            )
            assert not _panel_open(page), (
                "the heatmap panel stayed open after an outside press; its default "
                "is unchanged"
            )
            assert not errors, f"JS errors: {errors}"

    def test_panel_stays_open_on_outside_press_when_disabled(self, browser, tmp_path):
        """``collapse_on_outside=False`` also works for HeatmapControl.

        The second half of the wiring proof: the flag reaches the shell through
        the same option for both controls, so it is not a LayerControl special
        case.
        """
        with use_page(_make_page, browser, tmp_path, collapse_on_outside=False) as (
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
            assert _panel_open(page)

            page.mouse.click(900, 450)
            page.wait_for_timeout(300)
            assert _panel_open(page), (
                "the heatmap panel collapsed on an outside press with "
                "collapse_on_outside=False"
            )
            assert not errors, f"JS errors: {errors}"

    def test_default_values_initialized(self, browser, tmp_path):
        """Constructor initializes all user-configurable defaults."""
        with use_page(_make_page, browser, tmp_path, expose_ctrl=True) as (
            page,
            errors,
        ):
            vals = page.evaluate(_js("HeatmapControl/read_defaults"))
            assert vals["numClasses"] == 6, (
                f"numClasses expected 6 got {vals['numClasses']}"
            )
            assert vals["borderWeight"] == 1.5, (
                f"borderWeight expected 1.5 got {vals['borderWeight']}"
            )
            assert vals["borderColor"] in ("#333", "#333333"), (
                f"borderColor got {vals['borderColor']}"
            )
            assert vals["labelShow"] is True, "labelShow should be True"
            assert vals["method"] == "jenks"
            assert vals["scheme"] == "Reds"
            assert vals["agg"] == "count"
            assert not errors, f"JS errors: {errors}"

    def test_classes_row_label_names_the_method_on_one_line(self, browser, tmp_path):
        """The classes row reads by its method, on one line, in both panels.

        The row has one visible label for two selects, so it takes the primary
        control's name (Method / 分类方法) — the same word the layer style
        panel shows. Each select keeps its own aria label (Method / Classes),
        and the shared 88px label column holds the word on one line inside the
        280px panel. Range.getClientRects() is the line-box count: the element
        rect always reports one row.
        """
        # One layer auto-selects on expand, which is what unhides the style
        # block (the rows exist in the DOM while it is hidden).
        with use_page(_make_page, browser, tmp_path, num_layers=1) as (
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
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl .foliplus-heatmap-extra-body:not(.foliplus-hidden)",
                state="visible",
                timeout=5000,
            )
            result = page.evaluate(
                _js("LayerControl/read_form_row_labels"),
                {"root": ".foliplus-heatmap-ctrl"},
            )
            assert result["ok"], result
            rows = {row["text"]: row for row in result["rows"]}
            # The visible label is locale-dependent; the panel's language follows
            # the browser, so pin both vocabularies rather than one page locale.
            label = next(
                (text for text in ("Method", "分类方法") if text in rows), None
            )
            assert label, f"no method-labelled row among {sorted(rows)}"
            row = rows[label]
            expected_aria = {
                "Method": ["Method", "Classes"],
                "分类方法": ["分类方法", "分级数"],
            }[label]
            assert row["labelLines"] == 1, (
                f"the Method label wrapped at the panel width: {row}"
            )
            assert row["labelWidth"] == pytest.approx(88, abs=0.5), row
            assert result["labelWidthToken"] == "88px", result
            assert result["panelWidthToken"] == "280px", result
            assert row["panelWidth"] == pytest.approx(280, abs=1), row
            assert row["ariaLabels"] == expected_aria, row
            assert not errors, f"JS errors: {errors}"

    def test_layer_selection_triggers_render(self, browser, tmp_path):
        """Selecting a layer calls renderHexagons (cachedFeatures should be set)."""
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

            # Select the first non-placeholder layer
            opts = page.evaluate(_js("HeatmapControl/read_layer_options"))
            assert opts, "No layer options found"
            page.evaluate(_js("HeatmapControl/select_layer"), opts[0])
            page.wait_for_timeout(2000)

            # overlay (Canvas) should be visible with content after renderHexagons
            has_cached = page.evaluate(_js("HeatmapControl/read_cached_features_set"))
            canvas_visible = page.evaluate(
                _js("HeatmapControl/read_canvas_display_visible")
            )
            assert has_cached, "cachedFeatures should be set after layer selection"
            assert canvas_visible, "Canvas should be visible after layer selection"
            assert not errors, f"JS errors: {errors}"
