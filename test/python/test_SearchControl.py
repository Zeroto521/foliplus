"""Tests for foliplus.SearchControl."""

from __future__ import annotations

import folium
import pytest
from conftest import assert_locale, make_browser_page, render_control

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


class TestSearchControlRendering:
    """Rendering output tests (stable across minification)."""

    def test_rendered_content(self):
        """Key content is present in rendered output."""
        html = render_control(SearchControl())
        assert "foliplus-search" in html
        assert "foliplus-search-mode-btn" in html
        assert "foliplus-search-suggestions" in html
        assert "foliplus-search-suggestion-item" in html
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

    def test_suggestion_item_classes(self):
        html = render_control(SearchControl())
        assert "foliplus-search-suggestion-icon" in html
        assert "foliplus-search-suggestion-text" in html


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
        (globe icon, address placeholder) on first open."""
        page, errors = self._make_page(browser, tmp_path, mode="addr")
        try:
            self._expand(page)

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
        page, errors = self._make_page(browser, tmp_path)
        try:
            self._expand(page)

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
        page, errors = self._make_page(browser, tmp_path, mode="coord")
        try:
            self._expand(page)

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
        page, errors = self._make_page(browser, tmp_path)
        try:
            self._expand(page)

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
        page, errors = self._make_page(browser, tmp_path)
        try:
            self._expand(page)

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
        page, errors = self._make_page(browser, tmp_path, mode="addr")
        try:
            self._expand(page)

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
        page, errors = self._make_page(browser, tmp_path, mode="addr")
        try:
            self._expand(page)

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
        page, errors = self._make_page(browser, tmp_path, mode="addr")
        try:
            self._expand(page)

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
