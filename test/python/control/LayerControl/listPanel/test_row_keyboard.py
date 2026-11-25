"""Browser tests: the row keyboard cursor and its visibility toggles.

The panel keeps a keyboard cursor (.foliplus-is-focused-row) that survives a
row click, toggles the focused row's checkbox on Space/Enter/ArrowLeft/
ArrowRight, reorders it on Ctrl+ArrowUp/ArrowDown, and returns the row to
exactly its untouched rest state on Escape; a click outside the panel clears
the cursor instead of leaving the last row highlighted.
"""

from __future__ import annotations

import folium
from conftest import _js, panel_ready, use_page

from ..helper_browser import LayerControlBrowserBase


class TestRowKeyboardBrowser(LayerControlBrowserBase):
    def test_keydown_space_toggles_visibility(self, browser, tmp_path):
        """Space toggles the focused layer's checkbox."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/keydown_space_toggles_visibility"))
            assert result is not None, "keydown_space_toggles_visibility failed"
            assert result["toggled"] is True, (
                f"Space should toggle visibility, got {result}"
            )

    def test_keydown_enter_toggles_visibility(self, browser, tmp_path):
        """Enter toggles the focused layer's checkbox."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/keydown_enter_toggles_visibility"))
            assert result is not None, "keydown_enter_toggles_visibility failed"
            assert result["toggled"] is True, (
                f"Enter should toggle visibility, got {result}"
            )

    def test_keydown_left_toggles_visibility(self, browser, tmp_path):
        """ArrowLeft toggles the focused layer's checkbox."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/keydown_left_toggles_visibility"))
            assert result is not None, "keydown_left_toggles_visibility failed"
            assert result["toggled"] is True, (
                f"ArrowLeft should toggle visibility, got {result}"
            )

    def test_keydown_right_toggles_visibility(self, browser, tmp_path):
        """ArrowRight toggles the focused layer's checkbox."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/keydown_right_toggles_visibility"))
            assert result is not None, "keydown_right_toggles_visibility failed"
            assert result["toggled"] is True, (
                f"ArrowRight should toggle visibility, got {result}"
            )

    def test_keydown_after_label_click_targets_clicked_row(self, browser, tmp_path):
        """Mouse-selecting a row moves the keyboard cursor to that row."""
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
            result = page.evaluate(
                _js("LayerControl/keydown_after_label_click_targets_clicked_row")
            )
            assert result is not None, (
                "keydown_after_label_click_targets_clicked_row failed"
            )
            assert result["toggled"] is True, (
                f"Enter after clicking a row label should toggle that row, got {result}"
            )

    def test_keydown_ctrl_up_moves_layer(self, browser, tmp_path):
        """Ctrl+ArrowUp moves the focused layer one position up."""
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
            result = page.evaluate(_js("LayerControl/keydown_ctrl_up_moves_layer"))
            assert result is not None, "keydown_ctrl_up_moves_layer failed"
            assert result["moved"] is True, (
                f"Ctrl+ArrowUp should move layer up, got {result}"
            )

    def test_keydown_ctrl_down_moves_layer(self, browser, tmp_path):
        """Ctrl+ArrowDown moves the focused layer one position down."""
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
            result = page.evaluate(_js("LayerControl/keydown_ctrl_down_moves_layer"))
            assert result is not None, "keydown_ctrl_down_moves_layer failed"
            assert result["moved"] is True, (
                f"Ctrl+ArrowDown should move layer down, got {result}"
            )

    def test_keydown_escape_restores_rest_state(self, browser, tmp_path):
        """Escape leaves the row indistinguishable from a never-touched row.

        The rest state depends on the layer's checked state, so both are
        pinned against a live reference row instead of hardcoded colors: a
        checked row falls back to the selected wash and the black type icon,
        an unchecked row to the plain surface and the muted icon. The drag
        grip stays hidden at rest either way — only the cursor recipe (arrow
        keys, Tab) and a real hover show it — and the more button returns to
        exactly the color it has on any resting row.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            white = self._sample_surface(page)

            def snapshot():
                return page.evaluate(_js("LayerControl/read_all_row_state"))

            def escape_first_row():
                page.evaluate(_js("LayerControl/dispatch_escape_on_first_row"))

            # ── checked rows: the restored row must equal the reference ──
            escape_first_row()
            page.mouse.move(5, 400)  # pointer away: no hover may mask rest
            page.wait_for_timeout(300)  # let the grip opacity transition settle
            checked = snapshot()
            # The reference row proves the selected wash is the live rest
            # state, so the equality below is not two rows broken alike.
            assert checked[1]["bg"] != "rgba(0, 0, 0, 0)", (
                "the untouched checked row must show the selected wash, got "
                + str(checked)
            )
            assert checked[0] == checked[1], (
                "an Escape-restored checked row must be indistinguishable "
                "from a never-touched row, got " + str(checked)
            )

            # ── unchecked rows: same contract against the plain surface ──
            page.evaluate(_js("LayerControl/uncheck_all_row_checkboxes"))
            escape_first_row()
            page.wait_for_timeout(300)
            unchecked = snapshot()
            assert unchecked[0] == unchecked[1], (
                "an Escape-restored unchecked row must be indistinguishable "
                "from a never-touched row, got " + str(unchecked)
            )
            assert unchecked[0]["bg"] == white, (
                "an unchecked row's rest state is the explicit white surface, got "
                + str(unchecked)
            )
            assert unchecked[0]["grip"] == "0", (
                "the drag grip stays hidden at rest, got " + str(unchecked)
            )
            # The more button does not rest the same color everywhere: a
            # checked row keeps it in the action color, an unchecked row in
            # the primary text color — so Esc must return it to different
            # colors depending on the checkbox, never to one uniform value.
            assert unchecked[1]["more"] != checked[1]["more"], (
                "a checked row rests the more button in the action color "
                "while an unchecked row rests it black, got "
                + str(checked)
                + " vs "
                + str(unchecked)
            )

    def test_outside_mousedown_clears_cursor(self, browser, tmp_path):
        """Clicking outside the panel drops the keyboard cursor.

        The .foliplus-is-focused-row marker is a panel-local navigation cursor, so
        clicking the map / another control must clear it rather than leaving the
        last navigated row highlighted. Uses mousedown so a panel-internal click
        that rebuilds the list (a fold button, a checkbox) is unaffected.
        """
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=False)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=False)
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
            result = page.evaluate(_js("LayerControl/outside_mousedown_clears_cursor"))
            assert result is not None, "outside_mousedown_clears_cursor failed"
            assert result["before"] is True, (
                f"cursor should be set before outside mousedown, got {result}"
            )
            assert result["after"] is False, (
                f"outside mousedown must clear the cursor, got {result}"
            )
