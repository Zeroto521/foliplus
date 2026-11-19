"""overlay-exclusion death tests (cross-control, browser).

The map:panel exclusive group closes a fold panel (Heatmap / Measure / Search
main panel) when another member opens. The five tests pin the real interactions
the bug produced on a live map:

1. The user real path: Heatmap expanded -> press the LayerControl row more
   button -> the Heatmap fold panel must collapse (that button calls
   stopPropagation, so only the registry document-capture press dispatch can
   see it).
2. collapse_on_outside=False keeps the fold panel open even when another
   map:panel member opens (the panel opted out of outside-press dismissal).
3. Measure and Search fold panels are mutually exclusive.
4. The LayerControl main panel is NOT a map:panel member (collapse_on_outside
   is False by design): opening a fold panel, and an outside press that closes
   it, must not take the main panel down.
5. A portalled picker / dropdown inside a fold panel does not collapse its own
   host (the portal root counts as inside that panel only).
"""

from __future__ import annotations

from conftest import _js, heatmap_ready, use_page

from .helper import _make_exclusion_page, _make_page, _panel_open

EXCLUSION = _js("HeatmapControl/read_exclusion_state")
MORE_CENTRE = _js("LayerControl/overlay_more_btn_centre")
DROPDOWN_CENTRE = _js("HeatmapControl/dropdown_trigger_centre")
DROPDOWN_OPEN = _js("HeatmapControl/dropdown_is_open")


class TestOverlayExclusionBrowser:
    """Cross-control map:panel exclusivity on a real map."""

    def test_clicking_layer_more_closes_open_heatmap(self, browser, tmp_path):
        """User real path: Heatmap open -> press LayerControl row more -> closes.

        The more button handler calls stopPropagation (root cause 2), so a
        document bubble listener can never see the press. Only the registry
        capture-phase press dispatch dismisses the fold panel.
        """
        with use_page(_make_exclusion_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)
            assert _panel_open(page), "heatmap panel did not expand"

            # The row more button only exists when the LayerControl main panel
            # is expanded (the layer list renders inside it).
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-item[data-layer-type=overlay]",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)

            centre = page.evaluate(MORE_CENTRE)
            assert centre, "no overlay row more button found"
            page.mouse.click(centre["x"], centre["y"])
            page.wait_for_selector(
                ".foliplus-layer-more-menu.open", state="attached", timeout=5000
            )
            state = page.evaluate(EXCLUSION)
            assert state["heatmap"]["expanded"] is False, (
                "the heatmap panel stayed open after the LayerControl more press; "
                "the registry capture-phase press dispatch must close it"
            )
            assert state["menuOpen"] is True, "the more menu did not open"
            assert not errors, f"JS errors: {errors}"

    def test_collapse_on_outside_false_keeps_panel(self, browser, tmp_path):
        """collapse_on_outside=False opts the fold panel out of the group
        outside-press dismissal: opening the more menu does not close it."""
        with use_page(
            _make_exclusion_page,
            browser,
            tmp_path,
            heatmap_kwargs={"collapse_on_outside": False},
        ) as (page, errors):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)
            assert _panel_open(page)

            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-item[data-layer-type=overlay]",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)

            centre = page.evaluate(MORE_CENTRE)
            assert centre
            page.mouse.click(centre["x"], centre["y"])
            page.wait_for_selector(
                ".foliplus-layer-more-menu.open", state="attached", timeout=5000
            )
            assert _panel_open(page), (
                "collapse_on_outside=False must keep the heatmap panel open even "
                "when another map:panel member opens"
            )
            assert not errors, f"JS errors: {errors}"

    def test_measure_and_search_are_mutually_exclusive(self, browser, tmp_path):
        """Opening Search closes an open Measure panel, and vice versa."""
        with use_page(
            _make_exclusion_page,
            browser,
            tmp_path,
            with_measure=True,
            with_search=True,
        ) as (page, errors):
            # Open Measure.
            page.evaluate(_js("MeasureControl/click_measure_toggle_button"))
            page.wait_for_selector(
                ".foliplus-measure-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)
            assert page.evaluate(_js("MeasureControl/read_measure_panel_expanded")), (
                "measure did not expand"
            )

            # Open Search -> Measure must close.
            page.evaluate(_js("SearchControl/click_toggle_btn"))
            page.wait_for_selector(
                ".foliplus-search.foliplus-is-expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(300)
            state = page.evaluate(EXCLUSION)
            assert state["search"]["expanded"] is True
            assert state["measure"]["expanded"] is False, (
                "opening Search must close the open Measure panel (map:panel group)"
            )

            # Toggle Measure open again -> Search must close.
            page.evaluate(_js("MeasureControl/click_measure_toggle_button"))
            page.wait_for_selector(
                ".foliplus-measure-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)
            state = page.evaluate(EXCLUSION)
            assert state["measure"]["expanded"] is True
            assert state["search"]["expanded"] is False, (
                "opening Measure must close the open Search panel (map:panel group)"
            )
            assert not errors, f"JS errors: {errors}"

    def test_layer_main_panel_stays_open_with_fold_panel(self, browser, tmp_path):
        """The LayerControl main panel is not a map:panel member (its default
        collapse_on_outside is False): opening a Heatmap fold panel, and an
        outside press that closes it, must not take the main panel down."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)
            initial = page.evaluate(EXCLUSION)
            assert initial["layer"]["expanded"] is True, "layer panel did not expand"

            # Open the Heatmap fold panel.
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)
            state = page.evaluate(EXCLUSION)
            assert state["layer"]["expanded"] is True, (
                "opening the heatmap fold panel must not close the LayerControl "
                "main panel (it is not a map:panel member)"
            )
            assert state["heatmap"]["expanded"] is True

            # An outside press closes the fold panel but leaves the main panel up.
            page.mouse.click(900, 450)
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-collapsed",
                state="attached",
                timeout=5000,
            )
            state = page.evaluate(EXCLUSION)
            assert state["layer"]["expanded"] is True, (
                "the press that collapsed the heatmap fold panel also collapsed "
                "the LayerControl main panel"
            )
            assert not errors, f"JS errors: {errors}"

    def test_portalled_dropdown_does_not_close_host(self, browser, tmp_path):
        """Opening the heatmap layer dropdown (portalled to <body>) must not
        collapse the host heatmap fold panel: the portal root counts the list
        as inside that panel only."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("HeatmapControl/click_toggle_button"))
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            heatmap_ready(page)
            assert _panel_open(page)

            centre = page.evaluate(DROPDOWN_CENTRE)
            assert centre, "no heatmap layer dropdown trigger found"
            page.mouse.click(centre["x"], centre["y"])
            page.wait_for_function(
                DROPDOWN_OPEN,
                timeout=3000,
            )
            assert _panel_open(page), (
                "opening the portalled layer dropdown collapsed the host heatmap "
                "fold panel (the portal root must count as inside)"
            )
            assert not errors, f"JS errors: {errors}"
