"""Browser tests for foliplus.LayerControl — enum filter, funnel, shared dropdown."""

from __future__ import annotations

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
from .helper import _geo_mixed


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
        layer = folium.FeatureGroup(name="Funnel row")
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
        layer = folium.FeatureGroup(name="Attrs pair")
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
        layer = folium.FeatureGroup(name="Enum filter")
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
            assert not errors, f"JS errors: {errors}"

    def test_enum_filter_keyboard_and_map_press_close(self, browser, tmp_path):
        """The dropdown keeps real keyboard focus: ArrowDown enters the list,
        Space toggles without closing it, one Escape closes the popup and the
        next closes the panel; a press on the map also closes it."""
        layer = folium.FeatureGroup(name="Enum keyboard")
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
        layer = folium.FeatureGroup(name="Enum dropdown")
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
        layer = folium.FeatureGroup(name="Wheel zoom")
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
        """The section header's clean-empty-folders button is the real end-to-end
        coverage of the empty-folder cleanup path.

        A folder layer is registered and then deleted, so #911's empty-folder
        freeze leaves a key with no live member; the header renders with a clean
        button. Clicking it removes the stale key and the button itself. The
        three empty-folder cleanup probes are referenced here so the browser-probe inventory
        sees them as reachable, not orphaned.
        """
        layer = folium.GeoJson(_geo_mixed, name="Roads")
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            panel_ready(page)

            seeded = page.evaluate(_js("LayerControl/seed_empty_folder"))
            assert seeded and seeded.get("deleted") is True, seeded
            assert seeded.get("header") is True, seeded

            header = page.evaluate(_js("LayerControl/read_folder_header"))
            assert header and header.get("exists") is True, header
            cleanup = header.get("cleanup")
            assert cleanup and cleanup.get("count", 0) >= 1, header
            assert cleanup.get("ariaLabel"), header

            counted = page.evaluate(_js("LayerControl/count_panel_rows"))
            assert counted and counted.get("headerCount", 0) >= 1, counted

            clicked = page.evaluate(_js("LayerControl/click_folder_cleanup"))
            assert clicked and clicked.get("clicked") is True, clicked
            assert clicked.get("remainingCount") == 0, clicked
            assert clicked.get("buttonGone") is True, clicked

            assert not errors, f"JS errors: {errors}"
