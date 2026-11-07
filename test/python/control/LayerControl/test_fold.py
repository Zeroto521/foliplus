"""Browser tests for foliplus.LayerControl — toggle-all & fold."""

from __future__ import annotations

import re

import folium
from conftest import (
    _js,
    render,
    use_page,
    use_raw_page,
)

from foliplus import LayerControl

from ._browser_base import LayerControlBrowserBase


class TestFoldBrowser(LayerControlBrowserBase):
    """Browser-level interaction checks — toggle-all & fold."""

    def test_toggle_all_checkbox_toggles_layers(self, browser, tmp_path):
        """Toggle-all checkbox toggles all layers in the role."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="A", overlay=True, show=True),
            folium.FeatureGroup(name="B", overlay=True, show=True),
            slug="toggle_all",
        ) as (page, _):
            # Check initial state — all overlays checked
            result = page.evaluate(_js("LayerControl/read_toggle_all_checked"))
            assert result is True, f"Expected toggle-all checked, got {result}"

    def test_toggle_all_survives_reload(self, browser, tmp_path):
        """Toggle-all off, then reload: the hidden set must come back from localStorage.

        The write is debounced at 100ms, so the reload has to wait past the
        timer. A reload inside that window previously restored the initial
        map state because the pending write was still queued.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="A", overlay=True, show=True),
            folium.FeatureGroup(name="B", overlay=True, show=True),
            slug="toggle_all_reload",
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_timeout(600)
            before = page.evaluate(_js("LayerControl/toggle_all_reloads_hidden"))
            assert before is not None and before["rows"], f"panel state: {before}"
            assert all(before["rows"]), f"expected all overlays on initially: {before}"

            # Deselect the whole overlay role, then wait past the 100ms debounce.
            page.evaluate(_js("LayerControl/click_toggle_all"))
            page.wait_for_timeout(400)
            after_toggle = page.evaluate(_js("LayerControl/toggle_all_reloads_hidden"))
            assert after_toggle["rows"] == [False] * len(before["rows"]), (
                f"toggle-all did not deselect the role: {after_toggle}"
            )

            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(1200)
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_timeout(400)
            restored = page.evaluate(_js("LayerControl/toggle_all_reloads_hidden"))
            assert restored["rows"] == [False] * len(before["rows"]), (
                f"reload restored the initial map state: {restored} "
                f"(before reload: {after_toggle})"
            )
            assert not errors, f"console errors: {errors}"

    # ── title / tooltip browser tests ──

    def test_fold_toggle_hides_overlay_items(self, browser, tmp_path):
        """Clicking the overlay fold-toggle-btn hides overlay layer items."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False).add_to(
            m
        )
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="Overlay B", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_overlay.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )

            # Click the overlay fold button
            page.evaluate(_js("LayerControl/click_overlay_fold_button"))
            page.wait_for_timeout(300)

            # Verify overlay items are hidden
            result = page.evaluate(_js("LayerControl/read_overlay_item_displays"))
            assert all(d == "none" for d in result), (
                f"Expected all overlay items hidden, got {result}"
            )

            # Verify base items are still visible
            base_result = page.evaluate(_js("LayerControl/read_base_item_displays"))
            assert all(d != "none" for d in base_result), (
                f"Expected base items visible, got {base_result}"
            )

    def test_fold_toggle_hides_base_items(self, browser, tmp_path):
        """Clicking the base fold-toggle-btn hides base layer items."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False).add_to(
            m
        )
        folium.TileLayer("CartoDB dark_matter", name="Dark Mode", overlay=False).add_to(
            m
        )
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_base.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )

            # Click the base fold button
            page.evaluate(_js("LayerControl/click_base_fold_button"))
            page.wait_for_timeout(300)

            # Verify base items are hidden
            result = page.evaluate(_js("LayerControl/read_base_item_displays"))
            assert all(d == "none" for d in result), (
                f"Expected all base items hidden, got {result}"
            )

            # Verify overlay items are still visible
            overlay_result = page.evaluate(
                _js("LayerControl/read_overlay_item_displays")
            )
            assert all(d != "none" for d in overlay_result), (
                f"Expected overlay items visible, got {overlay_result}"
            )

    def test_fold_toggle_toggle_unfold(self, browser, tmp_path):
        """Clicking the fold button again unfolds (shows) the items."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="Overlay B", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_unfold.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )

            # Click fold button
            page.evaluate(_js("LayerControl/click_overlay_fold_button"))
            page.wait_for_timeout(300)

            # Verify folded
            folded = page.evaluate(_js("LayerControl/read_overlay_item_displays"))
            assert all(d == "none" for d in folded), (
                f"Expected hidden after fold, got {folded}"
            )

            # Click fold button again to unfold
            page.evaluate(_js("LayerControl/click_overlay_fold_button"))
            page.wait_for_timeout(300)

            # Verify unfolded
            unfolded = page.evaluate(_js("LayerControl/read_overlay_item_displays"))
            assert all(d != "none" for d in unfolded), (
                f"Expected visible after unfold, got {unfolded}"
            )

    def test_fold_preserves_dom_index(self, browser, tmp_path):
        """Folded items remain in the DOM for index alignment."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="C", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_dom_index.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )

            # Count DOM items before fold (3 overlays + 1 default OSM base + 1 color basemap)
            before = page.evaluate(_js("LayerControl/count_layer_items"))
            assert before > 0, "Expected at least 1 layer item"

            # Fold overlay
            page.evaluate(_js("LayerControl/click_overlay_fold_button"))
            page.wait_for_timeout(300)

            # Count DOM items after fold — should still be same (not removed)
            after = page.evaluate(_js("LayerControl/count_layer_items"))
            assert after == before, (
                f"Expected {before} items after fold, got {after} — DOM items should not be removed"
            )

    def test_toggle_all_indeterminate_state(self, browser, tmp_path):
        """Toggle-all checkbox becomes indeterminate when some (not all) layers are checked."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="C", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_indeterminate.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            # Step 1: All checked → toggle-all should be checked (not indeterminate)
            all_checked = page.evaluate(_js("LayerControl/read_toggle_all_state"))
            assert all_checked["checked"] is True, (
                "Expected toggle-all checked when all layers checked"
            )
            assert all_checked["indeterminate"] is False, (
                "Expected toggle-all NOT indeterminate when all layers checked"
            )

            # Step 2: Uncheck one layer → toggle-all should be indeterminate
            page.evaluate(_js("LayerControl/uncheck_one_overlay"))
            page.wait_for_timeout(300)

            partial = page.evaluate(_js("LayerControl/read_toggle_all_state"))
            assert partial["checked"] is False, (
                "Expected toggle-all unchecked when some layers checked"
            )
            assert partial["indeterminate"] is True, (
                "Expected toggle-all indeterminate when some (not all) layers checked"
            )

            # Step 3: Uncheck all layers → toggle-all should be unchecked (not indeterminate)
            page.evaluate(_js("LayerControl/uncheck_all_overlays"))
            page.wait_for_timeout(300)

            none = page.evaluate(_js("LayerControl/read_toggle_all_state"))
            assert none["checked"] is False, (
                "Expected toggle-all unchecked when no layers checked"
            )
            assert none["indeterminate"] is False, (
                "Expected toggle-all NOT indeterminate when no layers checked"
            )

    def test_toggle_all_click_indeterminate_deselects_all(self, browser, tmp_path):
        """Clicking indeterminate toggle-all deselects all layers."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="C", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_indeterminate_click.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            # Uncheck one layer to make toggle-all indeterminate
            page.evaluate(_js("LayerControl/click_first_overlay_checkbox"))
            page.wait_for_timeout(300)

            # Verify indeterminate
            state = page.evaluate(_js("LayerControl/read_toggle_all_indeterminate"))
            assert state is True, "Expected toggle-all indeterminate before click"

            # Click toggle-all (indeterminate → deselect all)
            page.evaluate(_js("LayerControl/click_toggle_all"))
            page.wait_for_timeout(300)

            # Verify all layers are now unchecked
            result = page.evaluate(_js("LayerControl/read_overlay_checked"))
            assert not any(result), f"Expected all layers unchecked, got {result}"

            # Verify toggle-all is now unchecked (not indeterminate)
            final = page.evaluate(_js("LayerControl/read_toggle_all_state"))
            assert final["checked"] is False, (
                "Expected toggle-all unchecked after deselect all"
            )
            assert final["indeterminate"] is False, (
                "Expected toggle-all NOT indeterminate after deselect all"
            )

    def test_keydown_nav_survives_fold_click(self, browser, tmp_path):
        """Folding a role must not kill keyboard navigation.

        Clicking the fold button fires onClick (which moves the cursor to the
        toggle-all row) and then renderInitialList (which rebuilds the DOM,
        destroying the focused node and dropping DOM focus to <body>). Without
        cursor re-homing the document-level keyboard listener's container guard
        then rejects every subsequent key, so ArrowDown / Enter stop working
        entirely. This test exercises all three: cursor survives, DOM focus is
        restored inside the panel, and keys still navigate + toggle.

        It also pins ArrowUp/Down stepping: folded rows are display:none and
        not focusable, so a plain index ± 1 would strand the cursor on a
        hidden row.
        """
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay1, overlay2) as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/keydown_nav_survives_fold_click"))
            assert result is not None, "keydown_nav_survives_fold_click failed"
            assert result["afterFold"] is not None, (
                f"Folding a role should not destroy the keyboard cursor, got {result}"
            )
            assert result["focusInPanel"] is True, (
                f"Folding a role should keep DOM focus inside the panel, got {result}"
            )
            assert result["afterFoldVisible"] is True, (
                "Re-homing after a fold must not land the cursor on a hidden row, "
                f"got {result}"
            )
            assert result["afterFoldFolded"] is False, (
                f"Re-homing after a fold must skip rows hidden by folding, got {result}"
            )
            assert result["afterDown"] is not None, (
                f"ArrowDown should still navigate after folding, got {result}"
            )
            assert result["afterDownVisible"] is True, (
                "ArrowDown must not leave the cursor on a folded-away row, got "
                f"{result}"
            )
            assert result["afterDownFolded"] is False, (
                f"ArrowDown must skip rows hidden by folding, got {result}"
            )
            assert result["afterUp"] is not None, (
                f"ArrowUp should still navigate after folding, got {result}"
            )
            assert result["afterUpVisible"] is True, (
                f"ArrowUp must not leave the cursor on a folded-away row, got {result}"
            )
            assert result["afterUpFolded"] is False, (
                f"ArrowUp must skip rows hidden by folding, got {result}"
            )
            assert result["afterUpClamped"] is not None, (
                "ArrowUp should clamp at the top instead of stepping off the "
                f"list, got {result}"
            )
            assert result["enterToggled"] is True, (
                f"Enter should still toggle after folding, got {result}"
            )
