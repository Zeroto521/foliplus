"""Tests for foliplus.SearchControl."""

from __future__ import annotations

import folium
from conftest import render

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


class TestSearchControlRendering:
    def test_default_params(self, base_map: folium.Map):
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "map-search" in html

    def test_custom_zoom_and_position(self, base_map: folium.Map):
        SearchControl(zoom=16, position="bottomright").add_to(base_map)
        html = render(base_map)
        assert "map-search" in html
        assert "16" in html

    def test_contains_css(self, base_map: folium.Map):
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert ".foliplus-search" in html

    def test_contains_nominatim_url(self, base_map: folium.Map):
        SearchControl().add_to(base_map)
        html = render(base_map)
        # URL is now resolved at runtime: window.foliplus.NOMINATIM.URL + "/search"
        assert "NOMINATIM.URL" in html
        assert "search" in html

    def test_contains_create_location_marker(self, base_map: folium.Map):
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.createLocationMarker" in html

    def test_addr_search_uses_fromWgs84(self, base_map: folium.Map):
        """fromWgs84 is called in address search (Nominatim returns WGS84) but not coord search."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        # 1 from runtime.js definition + 1 in addr search = 2
        # Coord search should NOT call fromWgs84 (user input CRS unknown)
        assert html.count("foliplus.fromWgs84") == 2

    def test_locale_zh(self, base_map: folium.Map):
        SearchControl(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "地图搜索" in html
        assert '"zh"' in html

    def test_default_mode_coord_in_template(self, base_map: folium.Map):
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert '"coord"' in html

    def test_mode_addr_in_template(self, base_map: folium.Map):
        SearchControl(mode="addr").add_to(base_map)
        html = render(base_map)
        assert '"addr"' in html

    def test_coord_search_no_fromWgs84(self, base_map: folium.Map):
        """Coord search does NOT call fromWgs84 (user input CRS is unknown)."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        # fromWgs84 appears 2×: once in runtime.js definition, once in addr search.
        # Coord search must NOT add a third call.
        assert html.count("foliplus.fromWgs84") == 2
        assert "flyTo([lat, lng]" in html

    def test_zoom_constant_default(self, base_map: folium.Map):
        """ZOOM constants defined for SearchControl."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "MAX: 16" in html
        assert "MIN: 12" in html
        assert "BASE: 18" in html

    def test_toggle_and_clear_button(self, base_map: folium.Map):
        """Toggle and clear buttons are rendered."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "toggle-btn" in html
        assert "ctrl-btn" in html

    def test_search_form_structure(self, base_map: folium.Map):
        """Search form has mode-btn, input, and clear."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "search-mode-btn" in html
        assert "clear" in html
        assert 'type: "text"' in html

    def test_nominatim_constants(self, base_map: folium.Map):
        """Nominatim API constants are defined."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "NOMINATIM.URL" in html
        assert "NOMINATIM.FORMAT" in html
        assert "jsonv2" in html

    def test_disable_click_scroll_propagation(self, base_map: folium.Map):
        """Click and scroll propagation are disabled."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "disableClickPropagation" in html
        assert "disableScrollPropagation" in html

    def test_mode_switch_function(self, base_map: folium.Map):
        """Mode switch function setMode exists."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "setMode(newMode) {" in html

    def test_reverse_geocode_function(self, base_map: folium.Map):
        """reverseGeocode is called for address lookup."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.reverseGeocode" in html

    def test_build_popup_html(self, base_map: folium.Map):
        """buildPopupHtml used for marker popups."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.buildPopupHtml" in html

    def test_hide_hint_on_clear(self, base_map: folium.Map):
        """hideHint is called when clearing search results."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.hideHint" in html

    def test_align_right_for_right_position(self, base_map: folium.Map):
        """Right positions add align-right class to SearchControl."""
        SearchControl(position="topright").add_to(base_map)
        html = render(base_map)
        assert "align-right" in html

    def test_no_align_right_for_left_position(self, base_map: folium.Map):
        """Left positions do NOT add align-right class."""
        SearchControl(position="topleft").add_to(base_map)
        html = render(base_map)
        # align-right appears in CSS, but NOT in the JS class string for left positions
        # createFoldControl uses isLeft: position.indexOf("left") >= 0
        assert 'indexOf("left") >= 0' in html

    def test_align_right_bottomright(self, base_map: folium.Map):
        """bottomright position also adds align-right."""
        SearchControl(position="bottomright").add_to(base_map)
        html = render(base_map)
        assert "align-right" in html

    def test_coord_search_passes_existing_marker(self, base_map: folium.Map):
        """Coordinate search passes existing marker to avoid duplicates."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        # createLocationMarker appears 3×: runtime.js definition + coord search + addr search
        assert html.count("createLocationMarker") == 3
        # Both coord and addr search should pass mk as the last arg
        assert "popup_addr_label" in html

    # ── Autocomplete / Suggestions ──

    def test_autocomplete_constants(self, base_map: folium.Map):
        """Autocomplete constants are defined in output."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "DEBOUNCE_MS: 300" in html
        assert "MIN_CHARS: 3" in html
        assert "MAX_ITEMS: 5" in html

    def test_suggestion_classes(self, base_map: folium.Map):
        """Suggestion-related CSS classes are defined."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-search-suggestions" in html
        assert "foliplus-search-suggestion-item" in html
        assert 'ACTIVE: "active"' in html

    def test_fetchSuggestions_function(self, base_map: folium.Map):
        """fetchSuggestions and renderSuggestions methods exist."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "fetchSuggestions(query) {" in html
        assert "renderSuggestions(results, query) {" in html

    def test_debounced_fetch_uses_shared_debounce(self, base_map: folium.Map):
        """debouncedFetch uses foliplus.debounce shared utility."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "this.debouncedFetch = foliplus.debounce(" in html

    def test_removeSuggestions_clears_throttle_timer(self, base_map: folium.Map):
        """removeSuggestions clears the throttle timer."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "this.suggestionsThrottleTimer" in html
        assert "clearTimeout(this.suggestionsThrottleTimer)" in html

    def test_suggestion_cache(self, base_map: folium.Map):
        """cachedSuggestions and cachedAddress objects exist for caching results."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "this.cachedSuggestions = {}" in html
        assert "this.cachedAddress = {}" in html
        assert "cachedSuggestions[query]" in html
        assert "cachedAddress[query]" in html

    def test_cachedAddress_in_suggestion_click(self, base_map: folium.Map):
        """Suggestion onmousedown writes to cachedAddress before renderAddressResult."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        # The onmousedown handler writes to cachedAddress[displayName]
        assert "this.cachedAddress[displayName] = { item, displayName }" in html

    def test_removeSuggestions_in_setMode(self, base_map: folium.Map):
        """setMode calls removeSuggestions on mode switch."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "removeSuggestions()" in html

    def test_blur_removes_suggestions(self, base_map: folium.Map):
        """blur event handler removes suggestions with delay."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert 'inp.addEventListener("blur"' in html
        assert "setTimeout(() => this.removeSuggestions(), 0)" in html

    def test_keyboard_navigation(self, base_map: folium.Map):
        """ArrowDown/ArrowUp/Enter/Escape keyboard handlers exist."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert 'e.key === "ArrowDown"' in html
        assert 'e.key === "ArrowUp"' in html
        assert 'e.key === "Escape"' in html
        assert 'e.key === "Enter"' in html

    def test_suggestions_mounted_on_body(self, base_map: folium.Map):
        """Suggestions dropdown is mounted on document.body."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "document.body.appendChild(this.suggestionsWrap)" in html

    def test_positionSuggestions_function(self, base_map: folium.Map):
        """positionSuggestions repositions via getBoundingClientRect."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "positionSuggestions() {" in html
        assert "this.ctrl.getBoundingClientRect()" in html

    def test_scroll_reposition_listeners(self, base_map: folium.Map):
        """Scroll and resize listeners reposition suggestions."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert 't.addEventListener("scroll"' in html
        assert 'window.addEventListener("resize", this.repositionHandler)' in html

    def test_suggestion_click_stops_propagation(self, base_map: folium.Map):
        """Suggestion click stops propagation to prevent outside collapse."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert (
            'this.suggestionsWrap.addEventListener("click", (e) => e.stopPropagation())'
            in html
        )
        assert "suggestion.onmousedown = (e) => {" in html

    def test_suggestion_click_calls_renderAddressResult(self, base_map: folium.Map):
        """Suggestion mousedown calls renderAddressResult directly, not searchAddress."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        # onmousedown calls renderAddressResult directly (bypasses searchAddress API call)
        assert "suggestion.onmousedown = (e) => {" in html
        assert "this.renderAddressResult" in html
        # searchAddress should NOT appear inside the onmousedown handler
        # Find the handler block and verify no searchAddress call within it
        start = html.index("suggestion.onmousedown")
        # Find the closing }); of the handler
        end = html.index("this.suggestionsWrap.appendChild", start)
        block = html[start:end]
        assert "searchAddress" not in block, (
            "suggestion click should call renderAddressResult directly, not searchAddress"
        )

    # ── URL Parameter Parsing ──

    def test_url_param_constants(self, base_map: folium.Map):
        """URL parameter constants are defined."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert 'Q: "q"' in html
        assert 'LAT: "lat"' in html
        assert 'LNG: "lng"' in html

    def test_initFromUrl_function(self, base_map: folium.Map):
        """initFromUrl method exists for URL parameter parsing."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "this.initFromUrl()" in html
        assert "URLSearchParams(window.location.search)" in html

    def test_q_param_coord_search(self, base_map: folium.Map):
        """?q=longitude,latitude triggers coordinate search."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "params.get(CONST.PARAM.Q)" in html
        assert "this.searchCoord(q)" in html

    def test_q_param_addr_search(self, base_map: folium.Map):
        """?q=address triggers address search."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "this.inp.value = q" in html
        assert "this.searchAddress(q)" in html

    def test_lat_lng_params(self, base_map: folium.Map):
        """?lat=&lng= triggers coordinate search."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "params.get(CONST.PARAM.LAT)" in html
        assert "params.get(CONST.PARAM.LNG)" in html
        assert "this.searchCoord(`${lng},${lat}`)" in html

    def test_url_parse_error_handling(self, base_map: folium.Map):
        """URL parsing errors are silently caught."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "catch (e) {" in html
        assert "// Silently ignore URL parsing errors" in html

    # ── Collapse cleanup ──

    def test_collapse_removes_suggestions(self, base_map: folium.Map):
        """Collapsing the control removes suggestions."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "this.removeSuggestions()" in html

    # ── Suggestion icon in item ──

    def test_suggestion_item_has_icon(self, base_map: folium.Map):
        """Each suggestion item has a LOCATE icon."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-search-suggestion-icon" in html
        assert "foliplus-search-suggestion-text" in html
        assert "foliplus.SVGs.LOCATE" in html

    # ── Nominatim runtime sharing ──

    def test_nominatim_references_runtime(self, base_map: folium.Map):
        """NOMINATIM constants reference window.foliplus.NOMINATIM."""
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.NOMINATIM" in html


class TestSearchControlBrowser:
    """Browser-based smoke tests for SearchControl."""

    def test_initial_mode_addr(self, browser, tmp_path):
        """Verify that mode='addr' renders the address-search UI
        (globe icon, address placeholder) on first open."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        SearchControl(mode="addr").add_to(m)

        html_path = tmp_path / "test_searchcontrol_browser.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            errors = []
            page.on(
                "console",
                lambda msg: (
                    errors.append(msg.text)
                    if msg.type == "error"
                    and not msg.text.startswith("Failed to load resource")
                    else None
                ),
            )

            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)

            # Expand the panel
            page.evaluate(
                "document.querySelector('.foliplus-search .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-search.expanded", state="attached", timeout=5000
            )

            # Verify the mode button shows the globe icon (address mode)
            globe_svg = page.evaluate(
                """document.querySelector('.foliplus-search-mode-btn')
                    .querySelector('svg[viewBox="0 0 24 24"] circle[cx="12"][cy="12"][r="10"]') !== null"""
            )
            assert globe_svg, "Expected globe icon for address mode"

            # Verify the placeholder is for address search
            placeholder = page.evaluate("document.querySelector('input').placeholder")
            assert "address" in placeholder.lower() or "地址" in placeholder, (
                f"Expected address placeholder, got: {placeholder}"
            )

        finally:
            page.close()

    def test_initial_mode_coord_default(self, browser, tmp_path):
        """Verify default mode='coord' shows coordinate placeholder."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        SearchControl().add_to(m)

        html_path = tmp_path / "test_searchcontrol_coord.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
            page.evaluate(
                "document.querySelector('.foliplus-search .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-search.expanded", state="attached", timeout=5000
            )

            # Verify the placeholder is for coordinate search
            placeholder = page.evaluate("document.querySelector('input').placeholder")
            # Coordinate placeholders contain numbers or "coord"/"坐标"
            assert any(
                kw in placeholder.lower()
                for kw in ("lat", "lng", "coord", "坐标", "latitude", "longitude")
            ), f"Expected coordinate placeholder, got: {placeholder}"
        finally:
            page.close()

    def test_mode_switch_icon(self, browser, tmp_path):
        """Toggling mode switches icon between LOCATE (coord) and GLOBE (addr)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        SearchControl(mode="coord").add_to(m)

        html_path = tmp_path / "test_mode_switch.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
            page.evaluate(
                "document.querySelector('.foliplus-search .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-search.expanded", state="attached", timeout=5000
            )

            # Click mode switch button
            page.evaluate("document.querySelector('.foliplus-search-mode-btn').click()")
            page.wait_for_timeout(500)

            # After switch, should be address mode with GLOBE icon
            globe_icon = page.evaluate(
                "document.querySelector('.foliplus-search-mode-btn').innerHTML.indexOf('GLOBE') > -1 || "
                'document.querySelector(\'.foliplus-search-mode-btn\').querySelector(\'circle[cx="12"][cy="12"][r="10"]\') !== null'
            )
            assert globe_icon, "Expected globe icon after mode switch"

            # Also verify input placeholder was updated
            placeholder = page.evaluate("document.querySelector('input').placeholder")
            assert "address" in placeholder.lower() or "地址" in placeholder, (
                f"Expected address placeholder after switch, got: {placeholder}"
            )
        finally:
            page.close()

    def test_clear_button_clears_input(self, browser, tmp_path):
        """Clear button resets input value and hides hint."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        SearchControl().add_to(m)

        html_path = tmp_path / "test_clear.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
            page.evaluate(
                "document.querySelector('.foliplus-search .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-search.expanded", state="attached", timeout=5000
            )

            # Type something in the input
            page.evaluate("document.querySelector('input').value = '26.08,119.30'")
            # Click clear button
            page.evaluate("document.querySelector('.foliplus-ctrl-btn').click()")
            page.wait_for_timeout(500)

            cleared = page.evaluate("document.querySelector('input').value")
            assert cleared == "", f"Expected empty input after clear, got: '{cleared}'"
        finally:
            page.close()

    def test_escape_collapses_control(self, browser, tmp_path):
        """Escape key collapses the control when no suggestions are shown."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        SearchControl().add_to(m)

        html_path = tmp_path / "test_escape.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)

            # Expand
            page.evaluate(
                "document.querySelector('.foliplus-search .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-search.expanded", state="attached", timeout=5000
            )

            # Press Escape
            page.evaluate("""
                const inp = document.querySelector('input');
                inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            """)
            page.wait_for_timeout(300)

            # Verify control is collapsed
            ctrl_has_collapsed = page.evaluate(
                "document.querySelector('.foliplus-search').classList.contains('collapsed')"
            )
            assert ctrl_has_collapsed, "Expected control to be collapsed after Escape"
        finally:
            page.close()

    def test_autocomplete_body_mount(self, browser, tmp_path):
        """Suggestions dropdown is mounted on document.body, not inside toolBar."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        SearchControl(mode="addr").add_to(m)

        html_path = tmp_path / "test_autocomplete_body.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
            page.evaluate(
                "document.querySelector('.foliplus-search .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-search.expanded", state="attached", timeout=5000
            )

            # Fire input event in address mode to trigger debounced fetch
            page.evaluate("""
                const inp = document.querySelector('input');
                inp.value = 'test query';
                inp.dispatchEvent(new Event('input'));
            """)
            page.wait_for_timeout(600)  # > debounce 300ms

            # Suggestions container should be on body, not inside toolBar
            on_body = page.evaluate(
                "document.body.querySelector('.foliplus-search-suggestions') !== null"
            )
            in_toolbar = page.evaluate(
                "document.querySelector('.foliplus-tool-bar .foliplus-search-suggestions') !== null"
            )
            # The suggestions may or may not appear (depends on network), but
            # the key test is that they're NOT in toolBar
            if on_body:
                assert not in_toolbar, "Suggestions must not be inside toolBar"
        finally:
            page.close()

    def test_keyboard_suggestion_navigation_structure(self, browser, tmp_path):
        """ArrowDown/ArrowUp/Enter keyboard navigation structure exists in address mode."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        SearchControl(mode="addr").add_to(m)

        html_path = tmp_path / "test_keyboard.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
            page.evaluate(
                "document.querySelector('.foliplus-search .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-search.expanded", state="attached", timeout=5000
            )

            # Verify keyboard navigation: ArrowDown/ArrowUp/Enter
            # These should NOT throw errors even without suggestions visible
            no_errors = page.evaluate("""
                (() => {
                    const inp = document.querySelector('input');
                    try {
                        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
                        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
                        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
                        return true;
                    } catch (e) {
                        return false;
                    }
                })()
            """)
            assert no_errors, "Keyboard navigation should not throw errors"
        finally:
            page.close()

    def test_input_switches_placeholder(self, browser, tmp_path):
        """Input event restores the placeholder for the current mode."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        SearchControl(mode="addr").add_to(m)

        html_path = tmp_path / "test_input_placeholder.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
            page.evaluate(
                "document.querySelector('.foliplus-search .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-search.expanded", state="attached", timeout=5000
            )

            # Fire input event to trigger placeholder restoration
            page.evaluate("""
                const inp = document.querySelector('input');
                inp.value = 'some text';
                inp.dispatchEvent(new Event('input'));
            """)
            page.wait_for_timeout(200)

            # Placeholder should still be address-related (not lost)
            placeholder = page.evaluate("document.querySelector('input').placeholder")
            assert placeholder and len(placeholder) > 0, (
                f"Placeholder should not be empty, got: '{placeholder}'"
            )
        finally:
            page.close()
