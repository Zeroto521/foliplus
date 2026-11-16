"""Browser tests for foliplus.LayerControl — enum filter, funnel, shared dropdown."""

from __future__ import annotations

import json
import re

import folium
from conftest import (
    _js,
    panel_ready,
    snippet,
    use_page,
)

from foliplus import LayerControl

from ._browser_base import LayerControlBrowserBase
from .helper import _geo_zone


class TestFilterBrowser(LayerControlBrowserBase):
    """Browser-level interaction checks — enum filter, funnel, shared dropdown."""

    def test_filtered_funnel_paints_neutral_with_currentcolor_fill(
        self, browser, tmp_path
    ):
        """A filtered row's funnel is neutral text-primary, not accent red.

        The icon ships its own fill, so the stylesheet must override it with
        fill: currentColor; otherwise `color` never reaches the glyph and the
        default black would vanish on a dark theme.
        """
        layer = folium.GeoJson(json.dumps(_geo_zone), name="Funnel row")
        with use_page(self._make_page, browser, tmp_path, layer, slug="funnel") as (
            page,
            errors,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            style = page.evaluate(_js("LayerControl/filter_funnel_style"))
            assert style and style.get("ok"), style
            assert style["color"] == style["textPrimary"], (
                "filtered funnel must use --foliplus-text-primary, got "
                f"{style['color']} vs token {style['textPrimary']}"
            )
            assert style["color"] != style["accent"], (
                "the filtered funnel must not be accent, got "
                f"{style['color']} (accent {style['accent']})"
            )
            assert style["fill"] == style["color"], (
                "the funnel SVG must fill from currentColor, got "
                f"fill {style['fill']} vs color {style['color']}"
            )
            assert (style["funnelWidth"], style["funnelHeight"]) == (12, 12), style
            assert style["countText"] == "4", style
            assert not errors, f"JS errors: {errors}"

    def test_attrs_features_shows_filtered_pair(self, browser, tmp_path):
        """Attributes → Features renders grouped kept / total for a filtered owner.

        The pair comes from the same filterProvider model the row reads, so it
        is exact grouped integers (2,500 / 6,000) — the panel is the detail
        view and never repeats the compact column value.
        """
        layer = folium.GeoJson(json.dumps(_geo_zone), name="Attrs pair")
        with use_page(self._make_page, browser, tmp_path, layer, slug="attr_pair") as (
            page,
            errors,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            res = page.evaluate(_js("LayerControl/attr_filtered_feature_pair"))
            assert res is not None, "attrs probe could not open its panel"
            assert res["pair"] == "2,500 / 6,000", res
            assert not errors, f"JS errors: {errors}"

    def test_enum_filter_body_filters_row_and_clears(self, browser, tmp_path):
        """The filter panel's enum body drives a generic owner end to end.

        A synthetic enum owner opens the panel from the row menu; the row label
        is the dimension's own name, the body is the shared multiple dropdown
        (never a native select), one press toggles a row without closing the
        popup, a second press adds another, and Clear returns the row and the
        readout to the unfiltered state.
        """
        layer = folium.GeoJson(json.dumps(_geo_zone), name="Enum filter")
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            res = page.evaluate(_js("LayerControl/filter_enum_body"))
            assert res is not None, "enum probe could not run"
            assert res.get("ok"), res
            # The page language follows the host browser locale, so the result
            # sentence is asserted structurally (percent prefix plus the kept /
            # total digits) rather than by literal English text.
            # The caption is the panel's shared "Values" vocabulary, localized
            # to the page language (the browser locale), never the component's
            # own word for the dimension.
            assert res["fieldLabel"] in ("Values", "值"), res
            # The P1 regression: the field row is present in the enum body,
            # addressable by data-* identity, and precedes the condition row.
            assert res["fieldRowPresent"] is True, res
            assert res["fieldRowLabel"] in ("Field", "字段"), res
            assert res["fieldRowBeforeValue"] is True, res
            # The no-fields owner gets the identity on a read-only cell (never
            # a native select — the field cell only hosts the picker when the
            # owner actually exposes more than one field).
            assert res["fieldRowHasSelect"] is False, res
            assert res["fieldRowSelectCount"] == 0, res
            # The shared primitive replaced the native listbox outright.
            assert res["triggerTag"] == "BUTTON", res
            assert res["triggerHaspopup"] == "listbox", res
            assert res["nativeMultipleSelects"] == 0, res
            assert res["panelSelects"] == 0, res
            # The popup is portalled out of the panel, and no option row was
            # rendered before it opened.
            assert res["listOpenBefore"] is False, res
            assert res["listOpenAfterOpen"] is True, res
            assert res["listParentInsidePanel"] is False, res
            assert res["optionValues"] == [
                "marker",
                "distance",
                "area",
                "circle",
            ], res
            assert res["selectedBefore"] == [], res
            assert res["resultBefore"].startswith("100%"), res
            assert "8" in res["resultBefore"], res

            assert res["selectedAfterFirst"] == ["marker"], res
            # Multiple semantics: the pick toggles the row and keeps the popup
            # usable for the next pick.
            assert res["listOpenAfterFirst"] is True, res
            assert res["labelAfterFirst"] == "Marker", res
            assert res["resultAfterFirst"].startswith("25%"), res
            assert re.search(r"2\D+8", res["resultAfterFirst"]), res
            assert res["rowAfterFirst"]["count"] == "2", res
            assert re.search(r"2\s*/\s*8", res["rowAfterFirst"]["title"] or ""), res

            assert res["selectedAfterSecond"] == ["marker", "distance"], res
            # Two or more picks collapse into the count summary on the trigger.
            assert re.search(r"\b2\b", res["labelAfterSecond"] or ""), res
            assert res["resultAfterSecond"].startswith("50%"), res
            assert res["rowAfterSecond"]["count"] == "4", res

            assert res["selectedAfterClear"] == [], res
            assert res["resultAfterClear"].startswith("100%"), res
            assert res["rowAfterClear"]["count"] == "8", res
            assert res["clearDisabled"] is True, res
            assert res["panelOpenAfterClear"] is True, (
                f"Clear must keep the filter panel open: {res}"
            )
            assert res["activeAfterClear"] and res["activeAfterClear"]["insidePanel"], (
                f"Clear must leave focus inside the panel: {res}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_field_row_survives_enum_switch(self, browser, tmp_path):
        """The field picker's row survives switching to an enum field (P1).

        A multi-field owner opens the panel on a range field; switching to the
        enum field rebuilds the body as the shared dropdown but MUST keep the
        field row — the panel still answers "which field" next to "what
        values". Both rows are addressable by their stable data-* identity,
        not by a shared class (the FILTER_FIELD class also names the field
        row, so a class-only query is ambiguous).
        """
        layer = folium.GeoJson(json.dumps(_geo_zone), name="Field picker")
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            res = page.evaluate(_js("LayerControl/filter_field_picker_persist"))
            assert res is not None, "field-picker probe could not run"
            assert res.get("ok"), res
            # Range state: the field row carries the range field, the value row
            # is the slider, and there is exactly one of each row.
            assert res["initialField"] == "mag", res
            assert res["initialFieldLabel"] in ("Field", "字段"), res
            assert res["initialValueRange"] is True, res
            assert res["initialFieldCount"] == 1, res
            assert res["initialValueCount"] == 1, res
            assert res["initialSelectValue"] == "mag", res
            # After switching to the enum field: the field row survives and
            # now carries the enum field; the value row is the enum dropdown.
            assert res["afterField"] == "kind", res
            assert res["afterValueEnum"] is True, res
            assert res["afterValueRange"] is False, res
            assert res["afterFieldCount"] == 1, res
            assert res["afterValueCount"] == 1, res
            assert res["afterSelectValue"] == "kind", res
            assert res["afterSelectOptions"] == ["mag", "kind"], res
            # The field row precedes the value row.
            assert res["fieldBeforeValue"] is True, res
            # The field row precedes the value row.
            assert res["fieldBeforeValue"] is True, res
            assert not errors, f"JS errors: {errors}"

    def test_range_slider_bubble_never_covers_field_row(self, browser, tmp_path):
        """The filter panel's range slider must not stand a bubble over the
        Field dropdown row (P3-1, PR #1261 rework).

        The range body renders the field row (which field) directly above the
        condition row (over what range). A standing bubble portals to <body> as
        a fixed overlay and lands on the row above whenever the thumb is near
        the top of the track; with the standing-bubble half reverted the bubble
        exists only during a drag/focus gesture and hides when the gesture
        ends, so the field row is never occluded at rest.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            res = page.evaluate(_js("LayerControl/filter_range_overlay"))
            assert res is not None, "range-overlay probe could not run"
            assert res.get("ok"), res
            # The range slider really rendered — the assertions are not vacuous.
            assert res["sliderPresent"] is True, res
            # P1-1 acceptance: at rest there is NO bubble, so the Field dropdown
            # row above the slider is never occluded by a standing readout.
            assert res["bubblesAtRest"] == [], (
                f"a standing bubble is present at rest: {res}"
            )
            # The bubble is a gesture affordance: it may show on focus but must
            # not persist after the gesture ends.
            if res["thumbCount"] > 0:
                assert res["bubblesOnFocus"], f"no bubble shown on focus: {res}"
                assert all(not b["on"] for b in res["bubblesAfterBlur"]), (
                    f"bubble persisted after blur: {res}"
                )
                # When the field row actually has layout, a live bubble must not
                # land on it (bbox non-intersection).
                if res["fieldRowBBox"]["width"] > 0 and res["bubblesOnFocus"]:
                    assert res["fieldOverlappedOnFocus"] is False, (
                        f"a bubble intersects the field row: {res}"
                    )
            assert not errors, f"JS errors: {errors}"

    def test_enum_filter_keyboard_and_map_press_close(self, browser, tmp_path):
        """The dropdown keeps real keyboard focus: ArrowDown enters the list,
        Space toggles without closing it, one Escape closes the popup and the
        next closes the panel; a press on the map also closes it."""
        layer = folium.GeoJson(json.dumps(_geo_zone), name="Enum keyboard")
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            setup = page.evaluate(_js("LayerControl/filter_enum_keyboard_setup"))
            assert setup and setup.get("ok"), setup
            assert setup["triggerTag"] == "BUTTON", setup
            assert setup["ariaExpanded"] == "false", setup
            assert setup["nativeMultipleSelects"] == 0, setup

            def state():
                return page.evaluate(_js("LayerControl/filter_enum_keyboard_state"))

            closed = state()
            assert closed["panelOpen"] is True, closed
            assert closed["popupOpen"] is False, closed
            assert closed["activeIsTrigger"] is True, closed
            assert closed["selected"] == [], closed

            # A real keyboard path: ArrowDown opens the popup and lands on the
            # first row; Space toggles it and the popup stays open.
            page.keyboard.press("ArrowDown")
            page.wait_for_timeout(80)
            assert state()["popupOpen"] is True, state()
            page.keyboard.press("Space")
            page.wait_for_timeout(120)
            picked = state()
            assert len(picked["selected"]) == 1, picked
            assert picked["popupOpen"] is True, picked
            # Focus stays in the control, not on the row.
            assert picked["activeIsOption"] is True, picked
            assert picked["activeRowId"] is None, picked
            assert picked["allOptionsHitTestable"] is True, picked
            assert picked["popupInsidePanel"] is False, picked

            # Escape belongs to the popup while it is open: it closes the list,
            # not the surface.
            page.keyboard.press("Escape")
            page.wait_for_timeout(120)
            escape_popup = state()
            assert escape_popup["popupOpen"] is False, escape_popup
            assert escape_popup["panelOpen"] is True, escape_popup
            assert escape_popup["activeIsTrigger"] is True, escape_popup

            page.keyboard.press("Escape")
            page.wait_for_timeout(120)
            escape_closed = state()
            assert escape_closed["panelOpen"] is False, escape_closed
            assert escape_closed["panelInDocument"] is False, escape_closed
            assert escape_closed["activeRowId"] == setup["id"], escape_closed

            # Reopen and dismiss by pressing the map.
            page.evaluate(_js("LayerControl/filter_enum_keyboard_setup"))
            page.wait_for_timeout(60)
            assert state()["panelOpen"] is True
            page.mouse.click(640, 40)
            page.wait_for_timeout(120)
            assert state()["panelOpen"] is False
            assert not errors, f"JS errors: {errors}"

    def test_enum_filter_uses_the_shared_dropdown(self, browser, tmp_path):
        """The enum body is the shared dropdown primitive, not a hand-rolled
        listbox and not a native select.

        The trigger keeps the shared form-select chrome, the popup is the shared
        menu shell mounted outside the panel, the rows are buttons with
        multi-select ARIA state, and a long option list is height-capped with an
        internal scrollbar instead of running past the viewport.
        """
        layer = folium.GeoJson(json.dumps(_geo_zone), name="Enum dropdown")
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)

            setup = page.evaluate(_js("LayerControl/filter_enum_keyboard_setup"))
            assert setup and setup.get("ok"), setup
            chrome = page.evaluate(snippet("LayerControl/filter_enum_chrome"))
            assert chrome["panelSelects"] == 0, chrome
            assert chrome["pageNativeMultiple"] == 0, chrome
            assert chrome["formSelectChrome"] is True, chrome
            assert chrome["haspopup"] == "listbox", chrome
            assert chrome["listRole"] == "listbox", chrome
            assert chrome["listMultiselectable"] == "true", chrome
            # The popup is portalled: it paints outside the panel's clip boxes.
            assert chrome["listInsidePanel"] is False, chrome
            assert chrome["optionRoles"] == ["option"] * 4, chrome
            assert chrome["optionSelected"] == ["false"] * 4, chrome
            # The data-* identity contract: exactly one field row and one value
            # row in the enum body, both addressable without the shared class.
            assert chrome["fieldRowCount"] == 1, chrome
            assert chrome["fieldRowIdentity"] == ["type"], chrome
            assert chrome["valueRowCount"] == 1, chrome
            assert chrome["valueRowIdentities"] == ["enum"], chrome
            # A class-only query matches BOTH rows (the field row also carries
            # FILTER_FIELD), so the data-* query is the disambiguating path.
            assert chrome["classMatchCount"] >= 2, chrome

            # Twelve options, eight-row cap: the popup scrolls internally.
            scroll = page.evaluate(_js("LayerControl/filter_enum_scroll_probe"))
            assert scroll and scroll.get("ok"), scroll
            assert scroll["optionValues"] == list("abcdefghijkl"), scroll
            assert scroll["popupInsidePanel"] is False, scroll
            assert scroll["maxHeight"] != "none", scroll
            assert scroll["scroll"]["scroll"] > scroll["scroll"]["client"], scroll
            assert not errors, f"JS errors: {errors}"

    def test_dropdown_wheel_does_not_zoom_map(self, browser, tmp_path):
        """A wheel over the open dropdown popup must not zoom the map.

        The popup is portalled out of the control container, so the container's
        disableScrollPropagation does not cover it — without the wheel
        stop-propagation the event bubbles to the map container and Leaflet's
        scrollWheelZoom fires. The list keeps its own overflow-y scroll because
        only propagation is stopped, not the default.
        """
        layer = folium.GeoJson(json.dumps(_geo_zone), name="Wheel zoom")
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)

            probe = page.evaluate(_js("LayerControl/dropdown_wheel_zoom_probe"))
            assert probe and probe.get("ok"), probe
            assert probe["optionCount"] >= 12, probe
            assert probe["listOpen"] is True, probe
            assert probe["listScrollable"] is True, probe
            # The popup is portalled onto the map container in pseudo mode, so a
            # wheel over it would bubble to Leaflet's scrollWheelZoom without the
            # stop-propagation — this is the exact case the fix targets.
            assert probe["popupInsideContainer"] is True, probe

            before_zoom = probe["zoomBefore"]
            page.mouse.move(probe["wheelX"], probe["wheelY"])
            page.mouse.wheel(0, 240)
            page.wait_for_timeout(350)

            after = page.evaluate(_js("LayerControl/dropdown_wheel_zoom_probe"))
            assert after and after.get("ok"), after
            # The map did not zoom.
            assert after["zoomBefore"] == before_zoom, (before_zoom, after)
            # The popup is still open and still usable.
            assert after["listOpen"] is True, after
            assert not errors, f"JS errors: {errors}"

    def test_folder_delete_clean_entries(self, browser, tmp_path):
        """The role row's clean-empty-folders menu entry is the real end-to-end
        coverage of the empty-folder cleanup path.

        A folder layer is registered and then deleted, so #911's empty-folder
        freeze leaves a key with no live member; the role row's overflow menu
        offers the cleanup entry enabled. Activating it (arm, then confirm)
        removes the stale key and its folder row. The three empty-folder cleanup
        probes are referenced here so the browser-probe inventory sees them as
        reachable, not orphaned.
        """
        layer = folium.GeoJson(_geo_zone, name="Roads")
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            panel_ready(page)

            seeded = page.evaluate(_js("LayerControl/seed_empty_folder"))
            assert seeded and seeded.get("deleted") is True, seeded
            assert seeded.get("header") is True, seeded

            header = page.evaluate(_js("LayerControl/read_folder_header"))
            assert header and header.get("exists") is True, header
            cleanup = header.get("cleanup")
            assert cleanup, header
            # The entry is enabled exactly when the section holds an empty
            # folder — that is the state this test seeded.
            assert cleanup.get("disabled") is False, header
            assert cleanup.get("ariaLabel"), header

            counted = page.evaluate(_js("LayerControl/count_panel_rows"))
            assert counted and counted.get("headerCount", 0) >= 1, counted

            clicked = page.evaluate(_js("LayerControl/click_folder_cleanup"))
            assert clicked and clicked.get("clicked") is True, clicked
            assert clicked.get("folderGone") is True, clicked

            assert not errors, f"JS errors: {errors}"

    def test_filter_enum_dropdown_search_reaches_past_cap(self, browser, tmp_path):
        """The truncated enum dropdown exposes a search box and reaches values
        beyond the render cap (commit3: search over a 40-value domain).

        A synthetic enum owner with a 40-value domain (marked truncated) is
        registered; the panel's enum dropdown must render a search input
        (threshold 30 <= domain size), filtering must reach the value past
        the 30-row cap, and selecting that value must commit to the filter.
        """
        layer = folium.GeoJson(_geo_mixed, name="Enum search")
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            panel_ready(page)
            res = page.evaluate(_js("LayerControl/filter_enum_search_body"))
            assert res is not None, "enum search probe could not run"
            assert res.get("ok"), res
            # The truncated domain renders a search box (threshold <= 30).
            assert res["searchBefore"] is True, res
            # The dropdown opens with a search input and no query shows the
            # render cap (30 rows for a 40-value domain).
            assert res["searchAfterOpen"] is True, res
            assert res["listOpen"] is True, res
            assert res["optionCountNoQuery"] <= 30, res
            # A query matching only the tail reaches the 31st+ value.
            assert res["optionCountFiltered"] >= 1, res
            assert res["filteredValue"] == "value-39", res
            assert res["statusText"], res
            # The value past the cap commits to the filter.
            assert res["selectedCount"] == 1, res
            assert res["selected"] == ["value-39"], res
            assert not errors, f"JS errors: {errors}"
