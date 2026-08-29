"""Tests for foliplus.SearchControl."""

from __future__ import annotations

import folium
import pytest
from conftest import (
    _js,
    assert_config_block,
    assert_config_value,
    assert_locale,
    make_browser_page,
    render_control,
    use_page,
)

from foliplus import SearchControl


class TestSearchControlPython:
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
        page.evaluate(
            "document.querySelector('.foliplus-search .foliplus-toggle-btn').click()"
        )
        page.wait_for_selector(
            ".foliplus-search.expanded", state="attached", timeout=5000
        )

    def test_initial_mode_addr(self, browser, tmp_path):
        """Verify that mode='addr' renders the address-search UI
        (pin icon, address placeholder) on first open."""
        with use_page(self._make_page, browser, tmp_path, mode="addr") as (
            page,
            errors,
        ):
            self._expand(page)

            # Verify the mode button shows the pin icon (LOCATE) for address mode
            # LOCATE has a small circle at cy=9 (pin head), GLOBE has a large circle at cy=12
            is_pin = page.evaluate(
                """document.querySelector('.foliplus-search-mode-btn')
                    .querySelector('circle[cx="12"][cy="9"]') !== null"""
            )
            assert is_pin, "Expected pin icon (LOCATE) for address mode"

            # Verify the placeholder is for address search
            placeholder = page.evaluate("document.querySelector('input').placeholder")
            assert "address" in placeholder.lower() or "地址" in placeholder, (
                f"Expected address placeholder, got: {placeholder}"
            )

    def test_initial_mode_coord_default(self, browser, tmp_path):
        """Verify default mode='coord' shows coordinate placeholder."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            self._expand(page)

            # Verify the placeholder is for coordinate search
            placeholder = page.evaluate("document.querySelector('input').placeholder")
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
        """Toggling mode switches from GLOBE (coord) to LOCATE (addr)."""
        with use_page(self._make_page, browser, tmp_path, mode="coord") as (
            page,
            errors,
        ):
            self._expand(page)

            # Coord mode starts with GLOBE (globe) icon
            # GLOBE has a large circle at cy=12, LOCATE has a small circle at cy=9
            is_globe = page.evaluate(
                """document.querySelector('.foliplus-search-mode-btn')
                    .querySelector('circle[cx="12"][cy="12"][r="10"]') !== null"""
            )
            assert is_globe, "Expected globe icon for coord mode"

            # Click mode switch button → switches to address mode
            page.evaluate("document.querySelector('.foliplus-search-mode-btn').click()")
            page.wait_for_timeout(500)

            # After switch, should be address mode with LOCATE (pin) icon
            is_pin = page.evaluate(
                """document.querySelector('.foliplus-search-mode-btn')
                    .querySelector('circle[cx="12"][cy="9"]') !== null"""
            )
            assert is_pin, "Expected pin icon (LOCATE) after mode switch to address"

            # Also verify input placeholder was updated
            placeholder = page.evaluate("document.querySelector('input').placeholder")
            assert "address" in placeholder.lower() or "地址" in placeholder, (
                f"Expected address placeholder after switch, got: {placeholder}"
            )

    def test_clear_button_clears_input(self, browser, tmp_path):
        """Clear button resets input value and hides hint."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            self._expand(page)

            # Type something in the input
            page.evaluate("document.querySelector('input').value = '26.08,119.30'")
            # Click clear button
            page.evaluate("document.querySelector('.foliplus-ctrl-btn').click()")
            page.wait_for_timeout(500)

            cleared = page.evaluate("document.querySelector('input').value")
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
        from foliplus import LayerControl

        m = folium.Map(location=[31.23, 121.47], zoom_start=10)
        LayerControl().add_to(m)
        SearchControl().add_to(m)
        folium.GeoJson(
            {
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [121.4, 31.2],
                            [121.5, 31.2],
                            [121.5, 31.3],
                            [121.4, 31.3],
                            [121.4, 31.2],
                        ]
                    ],
                },
            },
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
                "() => !!document.querySelector('.leaflet-pane[class*=foliplus-layer]')",
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
            ctrl_has_collapsed = page.evaluate(
                "document.querySelector('.foliplus-search').classList.contains('collapsed')"
            )
            assert ctrl_has_collapsed, "Expected control to be collapsed after Escape"

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
            on_body = page.evaluate(
                "document.body.querySelector('.foliplus-search-result-panel') !== null"
            )
            in_toolbar = page.evaluate(
                "document.querySelector('.foliplus-tool-bar .foliplus-search-result-panel') !== null"
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
            placeholder = page.evaluate("document.querySelector('input').placeholder")
            assert placeholder and len(placeholder) > 0, (
                f"Placeholder should not be empty, got: '{placeholder}'"
            )
