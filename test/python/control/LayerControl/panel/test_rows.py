"""Split of test_panel.py by dimension."""

from __future__ import annotations

import json

import re

import time

from pathlib import Path

import folium

import pytest

from conftest import (
    _js,
    assert_map_unchanged,
    feature_collection,
    heatmap_ready,
    leaflet_path,
    leaflet_points,
    load_geojson,
    make_browser_page,
    map_center_zoom,
    panel_ready,
    point_feature,
    render,
    snippet,
    snippet_fn,
    touch_drag,
    use_page,
    use_raw_page,
)

from playwright.sync_api import TimeoutError

from foliplus import HeatmapControl, LayerControl

from ..helper import _expand_panel, _geo_mixed, _write_html

from ..helper_browser import LayerControlBrowserBase

class TestPanelBrowser(LayerControlBrowserBase):
    def test_cross_group_drag_shows_hint(self, browser, tmp_path):
        """Dragging overlay toward base role should show blocked hint."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        base = folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False)
        # The gate reads the hint's English wording, so pin the page locale
        # rather than depending on the machine's ambient language.
        with use_page(
            self._make_page, browser, tmp_path, overlay, base, locale="en"
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            page.wait_for_selector(
                '.foliplus-layer-item[data-layer-type="base"]',
                state="attached",
                timeout=5000,
            )

            ok = page.evaluate(_js("LayerControl/dispatch_cross_group_dragover"))
            assert ok, "Failed to dispatch simulated cross-role dragover"

            page.wait_for_selector(
                ".foliplus-hint-LayerControl", state="attached", timeout=5000
            )
            hint_text = page.evaluate(_js("LayerControl/read_hint_text"))
            # The refusal is named by its reason: a block belongs to one role,
            # so a cross-role drag answers "same section" (the user-facing word
            # for a role) rather than naming the two roles.
            assert ("same section" in hint_text.lower()) or ("同分组" in hint_text)
    def test_probe_leak_listener_control_group_grows(self, browser, tmp_path):
        """A single bare map.on() must register as a +1 in the listener sum.

        Control group for the drift gate above: if this control fails, the
        sumMapEvents measure is measuring nothing and the drift assertion
        in test_remove_readd_leaves_no_listener_residue has no teeth.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/probe_leak_listener"))
            assert result["delta"] > 0, (
                f"Leak control group: expected a positive delta, got {result!r}"
            )
            assert not errors, f"JS errors: {errors}"
    def test_rename_input_fills_row_height(self, browser, tmp_path):
        """The inline rename input spans the full row height (not a 19.6px line).

        Regression guard for the scoped `.foliplus-layer-ctrl .foliplus-layer-item`
        padding rule outranking a bare `.foliplus-layer-renaming` rule — if that
        priority regresses, the row keeps its 8px vertical padding and the input
        collapses back to a single line.
        """
        layer = folium.FeatureGroup(name="My Layer")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="rename_visual"
        ) as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_selector(
                ".foliplus-layer-item",
                state="attached",
                timeout=5000,
            )

            ok = page.evaluate(_js("LayerControl/rename_first_layer"))
            assert ok, "failed to open the inline rename input"
            page.wait_for_selector(
                ".foliplus-layer-rename-input", state="attached", timeout=5000
            )

            m = page.evaluate(_js("LayerControl/read_rename_input_geom"))
            assert m is not None, "no renaming row found"
            # Row's vertical padding is dropped while renaming…
            assert m["padTop"] == "0px", f"row padTop={m['padTop']}"
            assert m["padBottom"] == "0px", f"row padBottom={m['padBottom']}"
            # …so the input fills the whole row, not a 19.6px line-box.
            assert abs(m["inputH"] - m["rowH"]) <= 1, (
                f"input height {m['inputH']} != row height {m['rowH']}"
            )
    def test_unregister_layer_in_browser(self, browser, tmp_path):
        """unregisterLayer removes a dynamically registered layer."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/unregister_layer_flow"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
            assert result is not None
            assert result["before"] is True
            assert result["after"] is False
    def test_click_one_overlay_no_sibling_checkbox_flash(self, browser, tmp_path):
        """Clicking one overlay row's checkbox must not flash its role siblings'
        checkboxes to an intermediate state.

        Regression for "sibling checkbox flashes when clicking one overlay
        row": a sibling checkbox
        briefly showing a state it was not already in means an intermediate
        sweep rewrote the row's cell between the click and its final paint. The
        single-writer path records intent for the clicked row and diffs once, so
        every sibling's checkbox stays at its start value until the browser
        settles.
        """
        overlays = [
            folium.FeatureGroup(name="Overlay A", overlay=True, show=True),
            folium.FeatureGroup(name="Overlay B", overlay=True, show=True),
            folium.FeatureGroup(name="Overlay C", overlay=True, show=True),
        ]
        with use_page(self._make_page, browser, tmp_path, *overlays) as (
            page,
            errors,
        ):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/sample_overlay_checkbox_click"))
            assert not result.get("error"), f"probe error: {result}"
            assert not errors, f"JS errors: {errors}"
            # Only the first row flipped; its two siblings kept their start
            # state throughout the click, no intermediate frame.
            assert result["finalState"][0] is False, (
                f"clicked row did not uncheck, got {result}"
            )
            for i in (1, 2):
                assert result["finalState"][i] is True, (
                    f"sibling {i} ended unchecked -- the click reached it: {result}"
                )
            # The regression: some frame between the click and the settle
            # painted a sibling's checkbox at a value different from its start.
            sibling_flips = []
            for sample in result["samples"]:
                if (
                    sample[1] != result["startState"][1]
                    or sample[2] != result["startState"][2]
                ):
                    sibling_flips.append(sample)
            assert not sibling_flips, (
                f"a sibling's checkbox flipped to an unexpected value during "
                f"the click -- checkbox flash. Samples: {sibling_flips}"
            )
    def test_render_initial_list_incremental(self, browser, tmp_path):
        """registerLayer on an existing UI must not rebuild the whole list.

        renderInitialList currently wipes innerHTML and re-creates every item,
        which is O(n) per registration (O(n^2) for n registrations). A
        registered layer should insert a single DOM item instead.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/render_initial_list_incremental"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
            assert result is not None, "LayerAPI not found"
            # After the initial attachUI render (1 call), dynamic registrations
            # must not trigger additional full rebuilds.
            assert result["afterSecond"] <= 1, (
                f"registerLayer triggered full rebuilds: {result['afterSecond']}"
            )
    def test_toggle_performance(self, browser, tmp_path):
        """Layer toggle and toggle-all operations complete within 100ms."""
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
            page.wait_for_timeout(300)
            results = page.evaluate(_js("LayerControl/performance_toggle"))
            assert results is not None, "performance_toggle failed"
            for r in results:
                assert r["ms"] < 100, f"{r['op']} took {r['ms']}ms (threshold: 100ms)"
    def test_layers_view_is_readonly(self, browser, tmp_path):
        """api.layers is a read-only view — direct mutation is blocked.

        External callers must go through LayerAPI (registerLayer/unregisterLayer
        etc.) so the registry index can never be bypassed or drift from the list.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/layers_view_readonly"))
            assert result is not None, "LayerAPI not found"
            assert result["length"] > 0, "read length failed"
            assert result["firstId"], "read index failed"
            assert result["mapped"] == result["length"], "read map failed"
            assert result["pushThrew"] is True, "push should throw"
            assert result["spliceThrew"] is True, "splice should throw"
            assert result["assignThrew"] is True, "index assign should throw"
            assert result["shiftThrew"] is True, "shift should throw"
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
    def test_plain_marker_layers_count_and_stay_stable(self, browser, tmp_path):
        """A leaf point layer counts as a point feature.

        Regression: countFeatureGeometry / getGeometryType gated on
        ``marker.feature``, so layers built from ``folium.Marker()`` reported a
        count of 0 and showed no type icon.  Counting must not require
        .feature (that only matters for extractPoints / Heatmap properties),
        and toggling an unrelated layer's checkbox must not reset the count.

        The layers here are single-feature GeoJson points (leaf overlays): the
        container semantics treat a folium.FeatureGroup as a container, so a
        plain point row must be a leaf layer.
        """
        layers = []
        for name in ["Alpha", "Beta", "Gamma", "Delta"]:
            # A leaf GeoJson point layer is a leaf (not a container), so the
            # container semantics now treat a FeatureGroup as a container
            # (Style/Filter disabled, 三态 count); a single-feature GeoJson
            # keeps this a plain point-feature overlay row.
            layer = folium.GeoJson(
                json.dumps(load_geojson("LayerControl", "point_11934_2611")),
                overlay=True,
                show=True,
            )
            layer.layer_name = name
            layers.append(layer)

        with use_page(self._make_page, browser, tmp_path, *layers) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            # initTypesAndVisibility (which paints the count columns) runs on a
            # 300ms INIT_DELAY_MS timer after attach, so settle before reading.
            page.wait_for_timeout(500)

            counts = page.evaluate(_js("LayerControl/read_count_columns"))
            assert counts is not None, "read_count_columns failed"
            assert len(counts) == 4, f"expected 4 overlay layers, got {len(counts)}"
            for info in counts.values():
                assert info["apiCount"] == 1, (
                    f"{info['name']!r}: plain folium.Marker should count as 1, "
                    f"got {info['apiCount']}"
                )
                assert info["countText"] == "1", (
                    f"{info['name']!r}: count column should read '1', "
                    f"got {info['countText']!r}"
                )

            # Toggling another layer's checkbox must not zero out the counts.
            page.evaluate(_js("LayerControl/set_test_layer_name_beta"))
            page.evaluate(_js("LayerControl/click_checkbox_by_name"))
            page.wait_for_timeout(300)

            after = page.evaluate(_js("LayerControl/read_count_columns"))
            assert after is not None, "read_count_columns failed after toggle"
            for info in after.values():
                assert info["apiCount"] == 1, (
                    f"{info['name']!r}: count changed to {info['apiCount']} "
                    f"after an unrelated checkbox click"
                )
                assert info["countText"] == "1", (
                    f"{info['name']!r}: count column changed to {info['countText']!r} "
                    f"after an unrelated checkbox click"
                )
    def test_initlayeritem_updates_only_the_id_match_row(self, browser, tmp_path):
        """initLayerItem stamps the row named by data-layer-id, not the one at
        the layer's registry index."""
        with use_page(self._make_page, browser, tmp_path, slug="initlayeritem") as (
            page,
            errors,
        ):
            panel_ready(page)
            state = page.evaluate(_js("LayerControl/initlayeritem_scrambled_dom"))
            assert state is not None, "LayerControl instance not reachable"
            # The precondition the assertion depends on: the row sitting at
            # alpha's registry index is a different layer, so only an id lookup
            # can find alpha's row.
            assert state["alphaRegistryIndex"] != state["alphaDomIndex"]
            # initLayerItem wrote alpha's name into alpha's own checkbox.
            assert state["labels"]["alpha"] == "A"
            # ...and left the neighbors' checkboxes alone. An index-based
            # lookup would have stamped "A" onto whoever sat at alpha's
            # registry index.
            assert state["labels"]["beta"] == "B", (
                "a neighbor's row was rewritten with alpha's name "
                f"({state['staleIndexWouldHaveHit']!r}) — row resolved by index"
            )
            assert state["labels"]["gamma"] == "C"
            # Ids the registry does not know about are declined.
            assert state["unknownReturnsFalse"] is False
            assert not errors, f"JS errors: {errors}"
    def test_dragdrop_relocates_only_the_id_match_row(self, browser, tmp_path):
        """handleDrop resolves the drop target by data-layer-id: a DOM-position
        read would have seen a self-drop and left the registry behind the
        panel."""
        with use_page(self._make_page, browser, tmp_path, slug="dragrow") as (
            page,
            errors,
        ):
            panel_ready(page)
            state = page.evaluate(
                _js("LayerControl/drag_scrambled_dom_only_updates_correct_row")
            )
            assert state is not None, "LayerControl instance not reachable"
            # The drop actually moved the registry. A DOM-position lookup reads
            # the target at the dragged layer's own index and aborts as a
            # self-drop, leaving the registry behind the panel.
            assert state["registryMoved"] is True, (
                f"the drop aborted: the target row was resolved by DOM position, "
                f"not id (registry stayed {state['beforeRegistry']})"
            )
            # Panel and registry agree once the drop has settled.
            assert state["panelMatchesRegistry"] is True, (
                f"panel {state['domIds']} drifted from registry "
                f"{state['afterRegistry']}"
            )
            assert state["dragDisarmed"] is True
            assert not errors, f"JS errors: {errors}"
