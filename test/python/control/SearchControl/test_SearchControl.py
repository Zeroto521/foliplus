"""Tests for foliplus.SearchControl."""

from __future__ import annotations

import folium
import pytest
from conftest import (
    _js,
    assert_config_block,
    assert_config_value,
    assert_locale,
    assert_map_unchanged,
    load_geojson,
    make_browser_page,
    map_center_zoom,
    render_control,
    snippet,
    snippet_fn,
    touch_drag,
    use_page,
)

from foliplus import LayerControl, SearchControl


class TestSearchControlConstructor:
    """Python-side property tests."""

    def test_name(self):
        assert SearchControl()._name == "SearchControl"

    def test_default_zoom(self):
        assert SearchControl().zoom == 15

    def test_custom_zoom(self):
        assert SearchControl(zoom=16).zoom == 16

    def test_default_position(self):
        assert SearchControl().position == "topleft"

    def test_custom_position(self):
        assert SearchControl(position="bottomright").position == "bottomright"

    def test_default_locale(self):
        assert SearchControl()._locale_code == ""

    def test_custom_locale(self):
        assert SearchControl(locale="zh")._locale_code == "zh"

    def test_default_mode(self):
        assert SearchControl().mode == "coord"

    def test_custom_mode_addr(self):
        assert SearchControl(mode="addr").mode == "addr"

    def test_custom_mode_coord(self):
        assert SearchControl(mode="coord").mode == "coord"

    def test_invalid_mode_raises(self):
        """Invalid mode raises ValueError."""
        with pytest.raises(ValueError, match="mode must be one of"):
            SearchControl(mode="invalid")

    def test_invalid_zoom_raises_too_low(self):
        """Zoom below 1 raises ValueError."""
        with pytest.raises(ValueError, match="zoom must be an int between 1 and 18"):
            SearchControl(zoom=0)

    def test_invalid_position_raises(self):
        """An unknown position is rejected, not silently ignored."""
        with pytest.raises(ValueError, match="position must be one of"):
            SearchControl(position="middle")

    def test_numpy_zoom_is_accepted(self):
        """A zoom read straight out of numpy is not an ``int`` subclass."""
        numpy = pytest.importorskip("numpy")
        assert SearchControl(zoom=numpy.int64(12)).zoom == 12

    def test_default_provider(self):
        assert SearchControl().provider == "nominatim"

    def test_default_provider_config(self):
        assert SearchControl().provider_config is None

    def test_builtin_provider(self):
        assert SearchControl(provider="photon").provider == "photon"
        assert SearchControl(provider="pelias").provider == "pelias"

    def test_invalid_provider_raises(self):
        with pytest.raises(ValueError, match="provider must be one of"):
            SearchControl(provider="bogus")

    def test_provider_config_passthrough(self):
        ctrl = SearchControl(
            provider="photon", provider_config={"baseUrl": "https://x"}
        )
        assert ctrl.provider_config == {"baseUrl": "https://x"}

    def test_provider_config_non_dict_raises(self):
        with pytest.raises(ValueError, match="provider_config must be a dict"):
            SearchControl(provider="photon", provider_config="nope")

    def test_custom_provider_dict(self):
        ctrl = SearchControl(provider={"id": "myapi", "baseUrl": "https://x"})
        assert ctrl.provider == {"id": "myapi", "baseUrl": "https://x"}

    def test_custom_provider_dict_missing_id_raises(self):
        with pytest.raises(ValueError, match="must contain an 'id' key"):
            SearchControl(provider={"baseUrl": "https://x"})

    def test_provider_config_with_dict_provider_raises(self):
        with pytest.raises(ValueError, match="only valid with a built-in"):
            SearchControl(provider={"id": "myapi"}, provider_config={"baseUrl": "x"})

    def test_provider_not_str_or_dict_raises(self):
        with pytest.raises(ValueError, match="provider must be a str or dict"):
            SearchControl(provider=42)  # type: ignore[arg-type]


class TestSearchControlProviderConfig:
    """Python ↔ JS bridge tests for provider serialization."""

    def test_provider_serialized_in_config(self):
        ctrl = SearchControl(provider="photon")
        assert_config_block(ctrl, {"provider": "photon", "provider_config": None})

    def test_provider_config_serialized_in_config(self):
        ctrl = SearchControl(
            provider="pelias",
            provider_config={"baseUrl": "https://geocode.example.com"},
        )
        assert_config_block(
            ctrl,
            {
                "provider": "pelias",
                "provider_config": {"baseUrl": "https://geocode.example.com"},
            },
        )

    def test_custom_provider_serialized_in_config(self):
        provider = {"id": "myapi", "baseUrl": "https://x.example.com"}
        ctrl = SearchControl(provider=provider)
        assert_config_block(ctrl, {"provider": provider})

    def test_provider_value_in_rendered_html(self):
        html = render_control(SearchControl(provider="photon"))
        assert_config_value(html, "provider", "photon")


class TestSearchControlRendering:
    """Rendering output tests (stable across minification)."""

    def test_rendered_content(self):
        """Key content is present in rendered output."""
        html = render_control(SearchControl())
        assert "foliplus-search" in html
        assert "foliplus-search-mode-btn" in html
        assert "foliplus-search-result-panel" in html
        assert "foliplus-search-result-item" in html
        assert "ctrl-fold" in html
        assert "align-right" in html

    def test_align_right_for_right_position(self):
        """Right positions add align-right class to SearchControl."""
        html = render_control(SearchControl(position="topright"))
        assert "align-right" in html

    def test_align_right_bottomright(self):
        """bottomright position also adds align-right."""
        html = render_control(SearchControl(position="bottomright"))
        assert "align-right" in html

    def test_contains_gcoord_dependency(self):
        html = render_control(SearchControl())
        assert "gcoord.global.prod.js" in html

    def test_locale_zh(self):
        html = render_control(SearchControl(locale="zh"))
        assert_locale(html, "地址搜索", "SearchControl.addr_placeholder")

    def test_result_panel_classes(self):
        html = render_control(SearchControl())
        assert "foliplus-search-result-panel" in html
        assert "foliplus-search-result-item" in html
        assert "foliplus-search-result-icon" in html
        assert "foliplus-search-result-text" in html
        assert "foliplus-search-result-content" in html
        assert "foliplus-search-result-coord" in html


class TestSearchControlBrowser:
    """Browser-based smoke tests for SearchControl."""

    def _make_page(self, browser, tmp_path, **kwargs):
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        SearchControl(**kwargs).add_to(m)
        html = m.get_root().render()
        page, errors = make_browser_page(browser, tmp_path, html, "search")
        page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
        return page, errors

    def _expand(self, page):
        """Click the toggle button and wait for the expanded state."""
        page.evaluate(_js("SearchControl/click_toggle_btn"))
        page.wait_for_selector(
            ".foliplus-search.foliplus-is-expanded", state="attached", timeout=5000
        )

    def test_initial_mode_addr(self, browser, tmp_path):
        """Verify that mode='addr' renders the address-search UI
        (pin icon, address placeholder) on first open."""
        with use_page(self._make_page, browser, tmp_path, mode="addr") as (
            page,
            errors,
        ):
            self._expand(page)

            # Verify the mode button shows the pin icon (ICON_LOCATION_PIN) for address mode
            # ICON_LOCATION_PIN has a small circle at cy=9 (pin head), ICON_GLOBE has a large circle at cy=12
            is_pin = page.evaluate(_js("SearchControl/read_mode_icon_coord"))
            assert is_pin, "Expected pin icon (ICON_LOCATION_PIN) for address mode"

            # Verify the placeholder is for address search
            placeholder = page.evaluate(_js("SearchControl/read_input_placeholder"))
            assert "address" in placeholder.lower() or "地址" in placeholder, (
                f"Expected address placeholder, got: {placeholder}"
            )

    def test_initial_mode_coord_default(self, browser, tmp_path):
        """Verify default mode='coord' shows coordinate placeholder."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            self._expand(page)

            # Verify the placeholder is for coordinate search
            placeholder = page.evaluate(_js("SearchControl/read_input_placeholder"))
            # Coordinate placeholders contain lat/lng terms (en: "latitude/longitude",
            # zh: "经度/纬度").
            assert any(
                kw in placeholder.lower()
                for kw in (
                    "lat",
                    "lng",
                    "coord",
                    "坐标",
                    "latitude",
                    "longitude",
                    "经度",
                    "纬度",
                )
            ), f"Expected coordinate placeholder, got: {placeholder}"

    def test_mode_switch_icon(self, browser, tmp_path):
        """Toggling mode switches from ICON_GLOBE (coord) to ICON_LOCATION_PIN (addr)."""
        with use_page(self._make_page, browser, tmp_path, mode="coord") as (
            page,
            errors,
        ):
            self._expand(page)

            # Coord mode starts with ICON_GLOBE (globe) icon
            # ICON_GLOBE has a large circle at cy=12, ICON_LOCATION_PIN has a small circle at cy=9
            is_globe = page.evaluate(_js("SearchControl/read_mode_icon_alt"))
            assert is_globe, "Expected globe icon for coord mode"

            # Click mode switch button → switches to address mode
            page.evaluate(_js("SearchControl/click_mode_btn"))
            page.wait_for_timeout(500)

            # After switch, should be address mode with ICON_LOCATION_PIN (pin) icon
            is_pin = page.evaluate(_js("SearchControl/read_mode_icon_coord"))
            assert is_pin, (
                "Expected pin icon (ICON_LOCATION_PIN) after mode switch to address"
            )

            # Also verify input placeholder was updated
            placeholder = page.evaluate(_js("SearchControl/read_input_placeholder"))
            assert "address" in placeholder.lower() or "地址" in placeholder, (
                f"Expected address placeholder after switch, got: {placeholder}"
            )

    def test_clear_button_clears_input(self, browser, tmp_path):
        """Clear button resets input value and hides hint."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            self._expand(page)

            # Type something in the input
            page.evaluate(_js("SearchControl/set_input_value"), "26.08,119.30")
            # Click clear button
            page.evaluate(_js("SearchControl/click_ctrl_btn"))
            page.wait_for_timeout(500)

            cleared = page.evaluate(_js("SearchControl/read_input_value"))
            assert cleared == "", f"Expected empty input after clear, got: '{cleared}'"

    def test_del_icon_removes_pin_and_clears_input(self, browser, tmp_path):
        """Floating ✕ appears with the popup and removes the pin + clears input."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            # Coordinate search → pin placed, but ✕ is hidden by default.
            page.evaluate(_js("SearchControl/trigger_coord_search"))
            page.wait_for_timeout(500)
            state = page.evaluate(_js("SearchControl/read_delicon"))
            assert not state["delIconVisible"], "✕ should be hidden by default"

            # Open the pin's popup → ✕ appears (unified with Measure/Locate).
            assert page.evaluate(_js("SearchControl/toggle_popup")), "pin not found"
            page.wait_for_selector(
                "[data-del-icon].visible", state="attached", timeout=10000
            )
            assert page.evaluate(_js("SearchControl/read_delicon"))["delIconVisible"]

            # Click the ✕ → pin removed + input cleared.
            clicked = page.evaluate(_js("SearchControl/click_delicon"))
            assert clicked, "no visible ✕ to click"
            page.wait_for_timeout(300)
            cleared = page.evaluate(_js("SearchControl/read_clear_state"))
            assert cleared["inputCleared"], "input should be cleared after clicking ✕"
            assert cleared["delIconCount"] == 0, "✕ should be removed after click"
            assert cleared["popupCount"] == 0, "popup should be closed after click"
            assert not errors, f"JS errors: {errors}"

    def test_search_pin_above_data_layers(self, browser, tmp_path):
        """Regression: search pin must render above LayerControl data layers.

        Data panes start at the markerPane's z-index (BASE == 600), so without
        the markerPane lift the pin would be hidden under overlay polygons.
        """
        m = folium.Map(location=[31.23, 121.47], zoom_start=10)
        LayerControl().add_to(m)
        SearchControl().add_to(m)
        folium.GeoJson(
            load_geojson("common", "shanghai_polygon"),
            name="Municipal Boundaries",
        ).add_to(m)
        html = m.get_root().render()
        with use_page(make_browser_page, browser, tmp_path, html, "search") as (
            page,
            errors,
        ):
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
            # Wait for LayerControl enforceOrder to create data panes (debounced).
            page.wait_for_function(
                _js("SearchControl/read_layer_pane_present"),
                timeout=10000,
            )
            z = page.evaluate(_js("SearchControl/read_pane_zindex"))
            assert z["dataPane"] is not None, "data layer pane not found"
            assert z["markerPane"] > z["dataPane"], (
                f"markerPane({z['markerPane']}) should be above data layers "
                f"({z['dataPane']})"
            )
            assert z["popupPane"] > z["markerPane"], (
                f"popup({z['popupPane']}) should stay above markers ({z['markerPane']})"
            )
            assert not errors, f"JS errors: {errors}"

    def test_escape_collapses_control(self, browser, tmp_path):
        """Escape key collapses the control when no suggestions are shown."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            self._expand(page)

            # Press Escape
            page.evaluate(_js("SearchControl/press_escape"))
            page.wait_for_timeout(300)

            # Verify control is collapsed
            ctrl_has_collapsed = page.evaluate(_js("SearchControl/read_is_collapsed"))
            assert ctrl_has_collapsed, "Expected control to be collapsed after Escape"

    def test_panel_collapses_on_outside_press_by_default(self, browser, tmp_path):
        """Default unchanged: a press outside the panel still collapses it.

        SearchControl binds ``bindOutsideCollapse`` on its own rather than
        through the shared panel shell, so this pins that its own binding is
        still live at the new parameter's default.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            self._expand(page)
            assert page.evaluate(_js("SearchControl/read_is_expanded")), (
                "the search panel did not expand"
            )

            page.mouse.click(900, 450)
            page.wait_for_selector(
                ".foliplus-search.foliplus-is-collapsed", state="attached", timeout=5000
            )
            assert page.evaluate(_js("SearchControl/read_is_collapsed")), (
                "the search panel stayed open after an outside press"
            )
            assert not errors, f"JS errors: {errors}"

    def test_result_panel_body_mount(self, browser, tmp_path):
        """Result panel (suggestions/history) is mounted on document.body, not inside toolBar."""
        with use_page(self._make_page, browser, tmp_path, mode="addr") as (
            page,
            errors,
        ):
            self._expand(page)

            # Fire input event in address mode to trigger debounced fetch
            page.evaluate(_js("SearchControl/fire_input_query"))
            page.wait_for_timeout(600)  # > debounce 300ms

            # Suggestions container should be on body, not inside toolBar
            on_body = page.evaluate(_js("SearchControl/read_result_panel_present"))
            in_toolbar = page.evaluate(
                _js("SearchControl/read_tool_bar_result_panel_present")
            )
            # The suggestions may or may not appear (depends on network), but
            # the key test is that they're NOT in toolBar
            if on_body:
                assert not in_toolbar, "Suggestions must not be inside toolBar"

    def test_keyboard_result_navigation_structure(self, browser, tmp_path):
        """ArrowDown/ArrowUp/Enter keyboard navigation structure exists in address mode."""
        with use_page(self._make_page, browser, tmp_path, mode="addr") as (
            page,
            errors,
        ):
            self._expand(page)

            # Verify keyboard navigation: ArrowDown/ArrowUp/Enter
            # These should NOT throw errors even without suggestions visible
            no_errors = page.evaluate(_js("SearchControl/fire_keyboard_nav"))
            assert no_errors, "Keyboard navigation should not throw errors"

    def test_input_switches_placeholder(self, browser, tmp_path):
        """Input event restores the placeholder for the current mode."""
        with use_page(self._make_page, browser, tmp_path, mode="addr") as (
            page,
            errors,
        ):
            self._expand(page)

            # Fire input event to trigger placeholder restoration
            page.evaluate(_js("SearchControl/fire_input_text"))
            page.wait_for_timeout(200)

            # Placeholder should still be address-related (not lost)
            placeholder = page.evaluate(_js("SearchControl/read_input_placeholder"))
            assert placeholder and len(placeholder) > 0, (
                f"Placeholder should not be empty, got: '{placeholder}'"
            )

    def test_coord_history_click_restores_coord_display(self, browser, tmp_path):
        """Clicking a coord history entry puts the coord display into the
        input so it matches what the panel shows (the reverse-geocoded
        address is display-only)."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            # Seed one coord history entry whose address differs from its
            # query, then reload so the component picks it up on init.
            page.evaluate(_js("SearchControl/seed_history_entry"))
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
            self._expand(page)

            # Empty input → history panel shows the seeded coord entry.
            page.wait_for_selector(
                ".foliplus-search-result-item", state="attached", timeout=5000
            )
            # The item displays the reverse-geocoded address; clicking it puts
            # the coord display into the input so the input matches the panel.
            value = page.evaluate(_js("SearchControl/click_history_entry"))
            assert value == "121.4700, 31.2300", (
                f"Input should be the coord display, got: {value!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_coord_history_keyboard_restores_coord_display(self, browser, tmp_path):
        """ArrowDown onto a coord history entry puts the coord display into
        the input (real fromWgs84, keyboard path)."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("SearchControl/seed_history_entry"))
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
            self._expand(page)
            page.wait_for_selector(
                ".foliplus-search-result-item", state="attached", timeout=5000
            )
            state = page.evaluate(_js("SearchControl/keyboard_select_history"))
            assert state["error"] is None, state["error"]
            assert state["value"] == "121.4700, 31.2300", (
                f"Input should be the coord display, got: {state['value']!r}"
            )
            assert state["dataQuery"] == "121.4700, 31.2300"
            assert not errors, f"JS errors: {errors}"

    def test_panel_wheel_scrolls_panel_not_map(self, browser, tmp_path):
        """Wheel over the open history panel scrolls the panel, not the map.

        The result panel is mounted on the map container, so without the wheel
        stop-propagation a wheel bubbles to Leaflet's scrollWheelZoom and zooms
        the map while the panel's own overflow-y also scrolls. The shared
        containment swallows every wheel unconditionally, so the map zoom must
        stay fixed while the panel scroll position advances.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("SearchControl/seed_scrollable_history"))
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
            self._expand(page)
            page.wait_for_selector(
                ".foliplus-search-result-item", state="attached", timeout=5000
            )

            before = page.evaluate(
                _js("SearchControl/read_panel_wheel_state"), {"inject": 40}
            )
            assert before and before.get("ok"), before
            assert before["itemCount"] >= 40, before
            assert before["scrollable"] is True, before
            zoom_before = before["zoom"]

            # Wheel down over the panel centre: it must scroll the panel and
            # leave the map zoom untouched.
            page.mouse.move(before["wheelX"], before["wheelY"])
            page.mouse.wheel(0, 240)
            page.wait_for_timeout(200)
            after_scroll = page.evaluate(_js("SearchControl/read_panel_wheel_state"))
            print("AFTER_SCROLL:", after_scroll)
            assert after_scroll and after_scroll.get("ok"), after_scroll
            assert after_scroll["scrollTop"] > before["scrollTop"], (
                before["scrollTop"],
                after_scroll["scrollTop"],
            )
            assert after_scroll["zoom"] == zoom_before, (zoom_before, after_scroll)

            # Scroll past the bottom boundary: the map must still not zoom.
            page.mouse.wheel(0, 1000)
            page.mouse.wheel(0, 1000)
            page.wait_for_timeout(200)
            after_bottom = page.evaluate(_js("SearchControl/read_panel_wheel_state"))
            print("AFTER_BOTTOM:", after_bottom)
            assert after_bottom and after_bottom.get("ok"), after_bottom
            assert after_bottom["zoom"] == zoom_before, (zoom_before, after_bottom)

            # Scroll back to the top boundary and keep wheeling up: no zoom.
            page.evaluate(
                "() => { const p = document.querySelector('.foliplus-search-result-panel'); p.scrollTop = 0; }"
            )
            page.mouse.move(after_bottom["wheelX"], after_bottom["wheelY"])
            page.mouse.wheel(0, -240)
            page.wait_for_timeout(200)
            after_top = page.evaluate(_js("SearchControl/read_panel_wheel_state"))
            print("AFTER_TOP:", after_top)
            assert after_top and after_top.get("ok"), after_top
            assert after_top["zoom"] == zoom_before, (zoom_before, after_top)

            assert not errors, f"JS errors: {errors}"

    def test_keyboard_keeps_active_row_visible(self, browser, tmp_path):
        """ArrowDown navigation keeps the active history row inside the panel
        viewport (the list cursor scrolls the panel, not the map)."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("SearchControl/seed_scrollable_history"))
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
            self._expand(page)
            page.wait_for_selector(
                ".foliplus-search-result-item", state="attached", timeout=5000
            )
            result = page.evaluate(_js("SearchControl/keyboard_scroll_visible"))
            assert result and result.get("ok"), result
            assert result["anyScrolled"], result
            assert result["allActiveInView"], result
            assert not errors, f"JS errors: {errors}"


def _panel_up(geom: dict) -> bool:
    """True when the panel carries the up class (the class-list form).

    The null assertion matters: `panelUp == panelUp` would false-pass when the
    panel is fully dropped (None == None), so reading the class name forces the
    empty-panel case to fail loudly instead."""
    cls = geom["panelClass"]
    assert cls is not None, "placement panel missing: panelClass is None"
    return "foliplus-search-result-panel-up" in cls.split()


class TestSearchControlPlacementBrowser:
    """B-probes: floating panel placement geometry (S2b acceptance).

    Exercises the kernel-driven placement: side flip (B1/B2), horizontal clamp
    on a small viewport (B3), max-height scroll cap (B4), the map-container
    boundary (B5), and the re-pin flush after a resize (B6).
    """

    def _make_page(self, browser, tmp_path, **kwargs):
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        SearchControl(**kwargs).add_to(m)
        html = m.get_root().render()
        page, errors = make_browser_page(browser, tmp_path, html, "placement")
        page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
        return page, errors

    def _open_history_panel(self, page, count=1):
        """Seed history and expand the control to mount the floating panel."""
        page.evaluate(_js("SearchControl/seed_many_history"), count)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
        page.evaluate(_js("SearchControl/click_toggle_btn"))
        page.wait_for_selector(
            ".foliplus-search-result-item", state="attached", timeout=5000
        )

    def _wait_panel_settled(self, page):
        """Wait for the shared menu entrance animation to finish so the rect
        reflects the final (post-fade) position."""
        page.wait_for_function(
            _js("SearchControl/read_result_panel_settled"), timeout=8000
        )

    def _geometry(self, page):
        return page.evaluate(_js("SearchControl/read_placement_geometry"))

    def test_b1_flip_above_at_bottom(self, browser, tmp_path):
        """B1: control at the viewport bottom -> panel flips above the trigger."""
        with use_page(self._make_page, browser, tmp_path, position="bottomleft") as (
            page,
            errors,
        ):
            self._open_history_panel(page)
            g = self._geometry(page)
            p, c, v = g["panel"], g["control"], g["viewport"]
            assert p is not None, "panel not mounted"
            assert p["bottom"] <= v["innerHeight"] + 1, (
                f"panel bottom {p['bottom']} exceeds viewport {v['innerHeight']}"
            )
            assert p["bottom"] <= c["top"] + 1, (
                f"panel did not flip above the trigger: bottom {p['bottom']} > top {c['top']}"
            )
            assert _panel_up(g), f"panel did not flip above: class={g['panelClass']!r}"
            assert not errors, errors

    def test_b2_below_at_top(self, browser, tmp_path):
        """B2: control at the viewport top -> panel stays below the trigger."""
        with use_page(self._make_page, browser, tmp_path, position="topleft") as (
            page,
            errors,
        ):
            self._open_history_panel(page)
            g = self._geometry(page)
            p, c = g["panel"], g["control"]
            assert p is not None, "panel not mounted"
            assert p["top"] >= -1, f"panel top {p['top']} spills above the viewport"
            assert p["top"] >= c["bottom"] - 1, (
                f"panel is not below the trigger: top {p['top']} < bottom {c['bottom']}"
            )
            assert not _panel_up(g), (
                f"panel has an up class but should stay below: class={g['panelClass']!r}"
            )
            assert not errors, errors

    def test_b3_horizontal_clamp_small_screen(self, browser, tmp_path):
        """B3: 360px viewport -> the panel stays inside the viewport horizontally."""
        with use_page(self._make_page, browser, tmp_path, position="topright") as (
            page,
            errors,
        ):
            page.set_viewport_size({"width": 360, "height": 640})
            page.wait_for_timeout(300)
            self._open_history_panel(page)
            g = self._geometry(page)
            p, v = g["panel"], g["viewport"]
            assert p is not None, "panel not mounted"
            assert p["left"] >= -1, f"panel left {p['left']} spills left"
            assert p["right"] <= v["innerWidth"] + 1, (
                f"panel right {p['right']} exceeds viewport width {v['innerWidth']}"
            )
            assert not errors, errors

    def test_b4_max_height_scroll_cap(self, browser, tmp_path):
        """B4: tall history -> panel caps its height and scrolls, staying in view."""
        with use_page(self._make_page, browser, tmp_path, position="topleft") as (
            page,
            errors,
        ):
            self._open_history_panel(page, count=30)
            g = self._geometry(page)
            p, v = g["panel"], g["viewport"]
            assert p is not None, "panel not mounted"
            max_h = float(g["panelComputed"]["maxHeight"].replace("px", ""))
            assert max_h <= v["innerHeight"] + 1, (
                f"max-height {max_h} exceeds viewport {v['innerHeight']}"
            )
            # Death-shape: the max-height must not collapse (a "max-height: 0"
            # or absent floor would pass the <= viewport check alone). The panel
            # keeps at least 2 result rows visible.
            assert max_h >= 2 * g["itemHeight"], (
                f"max-height {max_h} below 2 rows ({g['itemHeight']} px each)"
            )
            assert (
                g["panelScroll"]["scrollHeight"] > g["panelScroll"]["clientHeight"]
            ), "tall panel must scroll (scrollHeight > clientHeight)"
            assert p["top"] >= -1 and p["bottom"] <= v["innerHeight"] + 1, (
                "panel spills outside the viewport vertically"
            )
            assert not errors, errors

    def test_b5_map_container_boundary(self, browser, tmp_path):
        """B5: the panel stays inside the map container (the placement bounds).

        The map is shrunk to a 600x400 box (smaller than the viewport) BEFORE the
        panel opens, so the kernel clamps to the smaller map bounds rather than the
        full viewport. The shrink must happen after the reload — the reload resets
        the CSS width/height override.
        """
        with use_page(self._make_page, browser, tmp_path, position="topleft") as (
            page,
            errors,
        ):
            # Seed + reload WITHOUT the toggle (the reload would reset the size).
            page.evaluate(_js("SearchControl/seed_many_history"), 1)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
            # Shrink the map to a 600x400 box (smaller than the viewport).
            page.evaluate(
                _js("SearchControl/set_map_box"), {"width": 600, "height": 400}
            )
            page.wait_for_timeout(300)
            page.evaluate(_js("SearchControl/click_toggle_btn"))
            page.wait_for_selector(
                ".foliplus-search-result-item", state="attached", timeout=5000
            )
            g = self._geometry(page)
            p, m, v = g["panel"], g["mapRect"], g["viewport"]
            assert p is not None, "panel not mounted"
            assert m["width"] < v["innerWidth"], (
                f"map not shrunk: {m['width']} vs viewport {v['innerWidth']}"
            )
            assert m["height"] < v["innerHeight"], (
                f"map not shrunk: {m['height']} vs viewport {v['innerHeight']}"
            )
            assert p["left"] >= m["left"] - 1, (
                f"panel left {p['left']} < map left {m['left']}"
            )
            assert p["right"] <= m["right"] + 1, (
                f"panel right {p['right']} > map right {m['right']}"
            )
            assert p["top"] >= m["top"] - 1, (
                f"panel top {p['top']} < map top {m['top']}"
            )
            assert p["bottom"] <= m["bottom"] + 1, (
                f"panel bottom {p['bottom']} > map bottom {m['bottom']}"
            )
            assert not errors, errors

    def test_b6_repin_stays_flush(self, browser, tmp_path):
        """B6: resizing keeps the panel flush with the trigger and inside bounds."""
        with use_page(self._make_page, browser, tmp_path, position="topleft") as (
            page,
            errors,
        ):
            self._open_history_panel(page)
            self._wait_panel_settled(page)
            g1 = self._geometry(page)
            page.set_viewport_size({"width": 1000, "height": 600})
            self._wait_panel_settled(page)
            g2 = self._geometry(page)
            assert g1["panel"] is not None and g2["panel"] is not None, (
                "panel not mounted"
            )
            # The gap between the panel and the trigger must be preserved (flush).
            d1 = g1["panel"]["top"] - g1["control"]["bottom"]
            d2 = g2["panel"]["top"] - g2["control"]["bottom"]
            assert abs(d1 - d2) < 3, f"top gap changed on resize: {d1} -> {d2}"
            l1 = g1["panel"]["left"] - g1["control"]["left"]
            l2 = g2["panel"]["left"] - g2["control"]["left"]
            assert abs(l1 - l2) < 3, f"left gap changed on resize: {l1} -> {l2}"
            # Death-shape: a flip to the other side would keep |Δgap| small, so
            # also assert the side is stable across the resize.
            assert _panel_up(g1) == _panel_up(g2), (
                f"panel flipped on resize: before class={g1['panelClass']!r}, after class={g2['panelClass']!r}"
            )
            p2, v2 = g2["panel"], g2["viewport"]
            assert p2["top"] >= -1 and p2["bottom"] <= v2["innerHeight"] + 1, (
                "panel spills outside the viewport after resize"
            )
            assert not errors, errors


class TestSearchPanelTouchBrowser:
    """A touch drag over the result panel scrolls it instead of the map."""

    def test_touch_drag_over_the_result_panel_does_not_pan_the_map(
        self, touch_browser, tmp_path
    ):
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        SearchControl(mode="addr").add_to(m)
        html = m.get_root().render()
        with use_page(make_browser_page, touch_browser, tmp_path, html, "search") as (
            page,
            errors,
        ):
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
            # 25 history entries overflow the panel, so it can actually scroll.
            page.evaluate(snippet("SearchControl/seed_search_history"))
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
            page.evaluate(
                "document.querySelector('.foliplus-search .foliplus-toggle-btn')?.click()"
            )
            page.wait_for_selector(
                ".foliplus-search.foliplus-is-expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(400)
            rect = page.evaluate(
                f"({snippet_fn('common/element_rect')})('.foliplus-search-result-panel')"
            )
            scrolled = f"({snippet_fn('common/read_scroll_top')})('.foliplus-search-result-panel')"
            st0 = page.evaluate(scrolled)
            before = map_center_zoom(page)
            touch_drag(
                page,
                rect["x"] + rect["w"] / 2,
                rect["y"] + rect["h"] / 2,
                rect["y"] + rect["h"] / 2 - 100,
            )
            page.wait_for_timeout(300)
            assert_map_unchanged(before, map_center_zoom(page))
            assert page.evaluate(scrolled) != st0
            assert not errors, f"JS errors: {errors}"
