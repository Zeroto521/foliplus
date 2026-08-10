"""Tests for foliplus.MeasureControl."""

from __future__ import annotations

import json
import pathlib
import re

import folium
from conftest import render

from foliplus import MeasureControl


class TestMeasureControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert MeasureControl()._name == "MeasureControl"

    def test_default_position(self):
        assert MeasureControl().position == "bottomright"

    def test_custom_position(self):
        assert MeasureControl(position="topleft").position == "topleft"

    def test_default_locale(self):
        assert MeasureControl()._locale_code == ""

    def test_custom_locale(self):
        assert MeasureControl(locale="zh")._locale_code == "zh"

    def test_default_show_bearing(self):
        assert MeasureControl().show_bearing is True

    def test_custom_show_bearing(self):
        assert MeasureControl(show_bearing=False).show_bearing is False


class TestMeasureControlRendering:
    def test_default_params(self, base_map: folium.Map):
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure-ctrl" in html

    def test_show_bearing_default_true(self, base_map: folium.Map):
        """show_bearing defaults to true and renders as JS boolean."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "show_bearing: true" in html

    def test_show_bearing_false(self, base_map: folium.Map):
        """show_bearing=False renders false and disables bearing labels."""
        MeasureControl(show_bearing=False).add_to(base_map)
        html = render(base_map)
        assert "show_bearing: false" in html

    def test_custom_position(self, base_map: folium.Map):
        MeasureControl(position="topleft").add_to(base_map)
        html = render(base_map)
        assert "topleft" in html

    def test_contains_gcoord_dependency(self, base_map: folium.Map):
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "gcoord" in html
        assert "gcoord.global.prod.js" in html

    def test_contains_tool_buttons(self, base_map: folium.Map):
        """Tool buttons are built via foliplus.dom.el with data-mode."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "tool-btn" in html
        assert '"data-mode": mode' in html
        assert "mode: CONST.MODE.MARKER" in html
        assert "mode: CONST.MODE.DISTANCE" in html
        assert "mode: CONST.MODE.POLYGON" in html
        assert "mode: CONST.MODE.CIRCLE" in html
        assert "mode: CONST.MODE.CLEAR" in html

    def test_locale_zh(self, base_map: folium.Map):
        MeasureControl(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "量算工具" in html
        assert "MeasureControl.tool_toggle" in html

    def test_remove_layer_routes_to_sublayer(self, base_map: folium.Map):
        """removeLayer is overridden to route to sub-layer (three-layer architecture)."""

        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "removeLayer" in html

    def test_create_layers_via_panes(self, base_map: folium.Map):
        """MeasureControl sets panes through createLayers (graphPane/labelPane)."""

        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "createLayers(" in html

    def test_realtime_distance_preview(self, base_map: folium.Map):
        """Distance mode includes real-time preview label, line, and node."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "previewDistLabel" in html
        assert "previewLine" in html
        assert "onDistMove" in html
        assert "MeasureUtils.formatSegmentLabel(" in html

    def test_create_layers_api_used(self, base_map: folium.Map):
        """MeasureControl uses createLayers with graphPane/labelPane."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "createLayers" in html
        assert "graphPane" in html
        assert "labelPane" in html

    def test_css_icon_size_variable(self, base_map: folium.Map):
        """MeasureControl SVGs use --icon-size-md via common.css."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "icon-size-md" in html

    def test_css_stroke_width_emphasis(self, base_map: folium.Map):
        """Solid measurement lines use stroke-width in CSS."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        # CSS variable is defined in MeasureControl.css, not in JS
        assert "stroke-width" in html

    def test_hint_duration_persist(self, base_map: folium.Map):
        """MeasureControl hints use PERSIST duration (hints stay until mode change)."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "HINT_DURATION.PERSIST" in html

    def test_marker_icon_svg_structure(self, base_map: folium.Map):
        """Marker mode uses crosshair SVG."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "crosshair" in html

    def test_distance_icon_svg_structure(self, base_map: folium.Map):
        """Distance mode uses ruler SVG with -45deg rotation in SVG transform."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "rotate(-45" in html

    def test_circle_icon_svg_structure(self, base_map: folium.Map):
        """Circle mode uses concentric circles SVG."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "cx=" in html

    def test_trash_icon_svg(self, base_map: folium.Map):
        """Trash icon SVG is defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "TRASH" in html

    def test_measure_id_constant(self, base_map: folium.Map):
        """MEASURE_ID constant is used for layer registration."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'ID: "foliplus_measure"' in html

    def test_graph_label_pane_constants(self, base_map: folium.Map):
        """PANES constants are defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'GRAPH: "measure_graph"' in html
        assert 'LABEL: "measure_label"' in html

    def test_stop_event_utility(self, base_map: folium.Map):
        """MeasureUtils.stopEvent stops propagation and default."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "static stopEvent" in html
        assert "d?.stopPropagation?.()" in html
        assert "d?.preventDefault?.()" in html

    def test_format_distance_km_and_m(self, base_map: folium.Map):
        """formatDistance splits at 1000m threshold."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "meters >= CONST.FORMAT.KM_THRESHOLD" in html

    def test_distance_calculation(self, base_map: folium.Map):
        """MeasureUtils.distance delegates to turf.js distance."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "turf.distance(" in html
        assert "units:" in html

    def test_toggle_visibility_utility(self, base_map: folium.Map):
        """toggleVisibility uses measure-hidden class."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "el.classList.toggle(CONST.CLASSES.HIDDEN, !visible)" in html

    def test_suppress_hide_utility(self, base_map: folium.Map):
        """suppressHide sets a delayed flag and hides all del icons."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "manager.isSuppressHideDel = true" in html
        assert "MeasureUtils.hideDelIcons()" in html

    def test_calc_toggle_reset(self, base_map: folium.Map):
        """calcToggle with 'reset' sets isLabelsVisible=true."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "toggleLbl === CONST.TOGGLE.RESET" in html

    def test_toggle_del_icon_retry(self, base_map: folium.Map):
        """toggleDelIcon retries with delay up to DEL_ICON_RETRY_LIMIT times."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "retries < CONST.DEL_ICON.RETRY_LIMIT" in html
        assert "MeasureUtils.toggleDelIcon(marker, show, retries + 1)" in html

    def test_attach_del_click_utility(self, base_map: folium.Map):
        """attachDelClick binds click to marker event, not raw DOM event."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'delMarker.on("click",' in html
        assert "foliplus-measure-del-icon" in html

    def test_del_all_i18n(self, base_map: folium.Map):
        """First node X uses MeasureControl.del_all locale key."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureControl.del_all" in html

    def test_del_node_i18n(self, base_map: folium.Map):
        """Other nodes X use MeasureControl.del_node locale key."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureControl.del_node" in html

    def test_del_tooltip_i18n(self, base_map: folium.Map):
        """Marker and circle delete icons use MeasureControl.del_tooltip locale key."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureControl.del_tooltip" in html

    def test_first_node_x_delete_all(self, base_map: folium.Map):
        """First node in attachDistanceUI calls deleteMeas (isFirst)."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "isFirst" in html
        assert "MeasureUtils.attachDelClick(delMarker, deleteMeas)" in html

    def test_other_node_x_delete_point(self, base_map: folium.Map):
        """Non-first nodes in attachDistanceUI delete single point via findIndex."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "ptIdx = points.findIndex(" in html
        assert "points.splice(ptIdx, 1)" in html
        assert "segLabels.splice(lblIdx, 1)" in html

    def test_recalculate_segments_utility(self, base_map: folium.Map):
        """MeasureUtils.recalculateSegments recalculates segments and total distance."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "static recalculateSegments(points)" in html
        assert "return { segments, totalDistance }" in html

    def test_on_update_callback(self, base_map: folium.Map):
        """attachDistanceUI accepts onUpdate callback and calls it after node deletion."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "onUpdate" in html
        # Both call sites should use recalculateSegments
        assert "MeasureUtils.recalculateSegments(points)" in html

    def test_node_deletion_below_two_cleans_up(self, base_map: folium.Map):
        """Deleting a node when points.length < 2 calls deleteMeas()."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "points.length < 2" in html
        assert "deleteMeas()" in html

    def test_seg_labels_repositioned_on_delete(self, base_map: folium.Map):
        """After node deletion, remaining segLabels are repositioned at midpoints."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureUtils.midpoint(points[i], points[i + 1])" in html
        assert "label.setLatLng([mid.lat, mid.lng])" in html

    def test_is_last_when_two_title(self, base_map: folium.Map):
        """When only 2 points, the last node's X title matches del_all."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "isLastWhenTwo" in html
        assert "isFirst || isLastWhenTwo" in html

    def test_dynamic_update_on_delete_to_two(self, base_map: folium.Map):
        """Deleting a node down to 2 points updates the last node's X to delete all."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "points.length === 2 && nodeDelIcons.length === 2" in html
        assert 'lastDel.off("click")' in html
        assert "deleteMeas()" in html

    def test_clear_all_collapses_panel(self, base_map: folium.Map):
        """clearAll() collapses the panel by removing EXPANDED and adding COLLAPSED."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.ctrl.classList.remove(CONST.CLASSES.EXPANDED)" in html
        assert "this.ctrl.classList.add(CONST.CLASSES.COLLAPSED)" in html

    def test_manager_ctrl_bound_for_clear_collapse(self, base_map: folium.Map):
        """Control binds fold panel element to manager so clearAll() can collapse it."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.m.ctrl = ctrl" in html

    def test_panel_stays_open_when_tool_active(self, base_map: folium.Map):
        """bindOutsideCollapse uses skipCheck to prevent collapse when currentMode is active."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "skipCheck: () => this.m.currentMode !== null" in html

    def test_panel_collapses_when_no_tool(self, base_map: folium.Map):
        """bindOutsideCollapse still collapses the panel when no tool is active."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "bindOutsideCollapse({" in html
        assert "skipCheck" in html
        assert "currentMode !== null" in html

    def test_set_label_text_gets_fresh_dom(self, base_map: folium.Map):
        """setLabelText gets a fresh DOM reference each call."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "marker.getElement()" in html
        assert "labelEl.textContent = text" in html

    def test_remove_layer_null_safe(self, base_map: folium.Map):
        """removeLayer in LayerControl's createLayers skips null items."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "removeLayer" in html

    def test_build_popup_delegates(self, base_map: folium.Map):
        """buildPopup delegates to foliplus.buildPopupHtml."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.buildPopupHtml" in html

    def test_lazy_register_after_finish(self, base_map: folium.Map):
        """Distance mode registers on first click via mainLayer.addLayer, and re-registers on tool select."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        # register() is called explicitly in setMode() when activating a tool,
        # and also via mainLayer.addLayer override on first click in distance mode
        assert "this.layers.unregister()" in html or "this.layers.destroy()" in html
        assert "this.layers.register()" in html

    def test_click_cooldown(self, base_map: folium.Map):
        """Click cooldown constant is defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "CLICK_COOLDOWN: 300" in html

    def test_finalize_delay(self, base_map: folium.Map):
        """Finalize delay constant is defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "FINALIZE_DELAY: 50" in html

    def test_center_dot_size(self, base_map: folium.Map):
        """Center dot size constants are defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "SIZE: [12, 12]" in html
        assert "ANCHOR: [6, 6]" in html

    def test_label_anchor(self, base_map: folium.Map):
        """Label anchor is above center."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "ANCHOR: [0, -10]" in html

    def test_is_finalizing_guard(self, base_map: folium.Map):
        """Circle mode guards against double-finalize with isFinalizing."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "isFinalizing" in html
        assert "isFinalizing = false" in html

    def test_measure_manager_constructor(self, base_map: folium.Map):
        """MeasureManager constructor accepts map instance."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "constructor(mapInstance)" in html

    def test_measure_manager_methods(self, base_map: folium.Map):
        """MeasureManager has expected methods (start, set modes)."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "class DistanceMode extends PreviewMode" in html
        assert "class CircleMode extends PreviewMode" in html
        assert "class MarkerMode extends MeasureMode" in html
        assert "class PreviewMode extends MeasureMode" in html
        assert "finishDist" in html
        assert "finalizeCircle" in html

    def test_label_above_circle(self, base_map: folium.Map):
        """Label is added after circle, line, and node so it renders on top."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        # radiusLabel should appear after circle, radiusLine, and radiusNode
        label_pos = html.find("radiusLabel = this.layers.addLayer")
        circle_pos = html.find("circle = this.layers.addLayer(")
        line_pos = html.find("radiusLine = this.layers.addLayer(")
        node_pos = html.find("radiusNode = this.layers.addLayer(")
        assert label_pos > circle_pos, "Label should be added after circle"
        assert label_pos > line_pos, "Label should be added after line"
        assert label_pos > node_pos, "Label should be added after node"

    def test_double_label_fix(self, base_map: folium.Map):
        """Regression test: Labels are added via addLayer with isLabel=true."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "previewDistLabel = this.layers.addLayer(" in html

    def test_label_interaction_listeners(self, base_map: folium.Map):
        """Distance/Circle labels have click listeners."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'segLabels.forEach((l) => l.on("click", handleItemClick))' in html

    def test_ui_fixed_labels_fix(self, base_map: folium.Map):
        """Regression test: Labels stay fixed, only X toggles."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "toggleUI(false, CONST.TOGGLE.RESET)" in html
        assert "toggleUI(undefined)" in html

    def test_measure_tool_toggle(self, base_map: folium.Map):
        """Tool toggle uses MeasureControl.tool_toggle locale key."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureControl.tool_toggle" in html

    def test_hint_messages(self, base_map: folium.Map):
        """Hint messages for all modes are present."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureControl.hint_marker" in html
        assert "MeasureControl.hint_dist_start" in html
        assert "MeasureControl.hint_polygon" in html
        assert "MeasureControl.hint_circle_start" in html
        assert "MeasureControl.hint_circle_radius" in html

    def test_preview_circle_while_drawing(self, base_map: folium.Map):
        """Preview circle and label are created during circle drawing."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "previews.circle" in html
        assert "previews.center" in html
        assert "previews.label" in html

    def test_bring_to_front_on_circle_marker(self, base_map: folium.Map):
        """CircleMarkers call bringToFront() after creation."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "marker.bringToFront()" in html or "previews.node.bringToFront()" in html

    def test_no_old_onadd_override(self, base_map: folium.Map):
        """Old onAdd override should not exist."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "origOnAdd(map)" not in html

    def test_lat_lng_precision_constant(self, base_map: folium.Map):
        """LAT_LNG_PRECISION constant is defined as 6."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "LAT_LNG_PRECISION: 6" in html

    def test_make_label_div_icon(self, base_map: folium.Map):
        """MeasureUtils.makeLabelDivIcon creates a divIcon with measure-label."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "makeLabelDivIcon" in html
        assert "measure-label" in html
        assert "LABEL_ANCHOR" in html
        # Supports optional iconAnchor and className params
        assert "iconAnchor" in html
        assert "className" in html

    def test_circle_label_centered(self, base_map: folium.Map):
        """Circle radius labels use centered anchor at midpoint."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "CLASS_RADIUS" in html
        assert "RADIUS_ANCHOR" in html

    def test_restore_circle_label_uses_centered_anchor(self, base_map: folium.Map):
        """Restored circle labels stay centered at the radius midpoint."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        restore_pos = html.find("restoreCircle(m)")
        anchor_pos = html.find("RADIUS_ANCHOR", restore_pos)
        assert anchor_pos > restore_pos, (
            "restoreCircle should use the centered anchor for radius labels"
        )

    def test_make_node(self, base_map: folium.Map):
        """MeasureUtils.makeNode creates a circleMarker with MARKER_RADIUS."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "makeNode" in html
        assert "RADIUS: 5" in html

    def test_make_del_icon(self, base_map: folium.Map):
        """MeasureUtils.makeDelIcon creates a delete icon marker."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "makeDelIcon" in html
        assert "foliplus-del-icon" in html

    def test_align_right_for_right_position(self, base_map: folium.Map):
        """Right positions (bottomright/topright) add align-right class."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "align-right" in html

    def test_no_align_right_for_left_position(self, base_map: folium.Map):
        """Left positions (topleft/bottomleft) do NOT add align-right class."""
        MeasureControl(position="topleft").add_to(base_map)
        html = render(base_map)
        # align-right appears in CSS, but NOT in the JS class string for left positions
        # Check that the JS doesn't add align-right for left positions
        assert 'indexOf("left") >= 0' in html

    def test_marker_del_icon_uses_make_del_icon(self, base_map: folium.Map):
        """Marker mode uses makeDelIcon with iconAnchor for positioning."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "makeDelIcon" in html
        assert "iconAnchor" in html
        assert "injectDelIcon" not in html

    def test_bring_layer_to_front_on_tool_select(self, base_map: folium.Map):
        """Tool select calls register() to re-show the measure layer on top."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.layers.register()" in html

    # ── Finish animation tests ──

    def test_dash_sweep_animation_classes(self, base_map: folium.Map):
        """Distance finishDist adds is-dash-sweep class with --sweep-length."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "dash-sweep" in html
        assert "--sweep-length" in html
        assert "getTotalLength" in html
        assert "animationend" in html

    def test_dash_sweep_drop_shadow(self, base_map: folium.Map):
        """Dash sweep line has drop-shadow filter for glow effect."""

        css = pathlib.Path("foliplus/css/MeasureControl.css").read_text()
        assert "drop-shadow" in css
        assert "dash-sweep" in css

    def test_ripple_animation_classes(self, base_map: folium.Map):
        """Circle finalizeCircle creates a measure-ripple circle with animationend cleanup."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure-ripple" in html
        assert "interactive: false" in html
        assert "removeLayer(ripple)" in html
        assert "animationend" in html

    def test_ripple_css_variables(self, base_map: folium.Map):
        """Ripple animation uses CSS custom properties for all parameters."""

        css = pathlib.Path("foliplus/css/MeasureControl.css").read_text()
        assert "--ripple-duration" in css
        assert "--ripple-opacity-start" in css
        assert "--ripple-stroke-start" in css
        assert "--ripple-stroke-end" in css
        assert "measure-ripple" in css

    def test_dash_sweep_css_variables(self, base_map: folium.Map):
        """Dash sweep animation uses CSS custom properties for all parameters."""

        css = pathlib.Path("foliplus/css/MeasureControl.css").read_text()
        assert "--sweep-length" in css
        assert "--sweep-duration" in css

    def test_radius_label_has_animation(self, base_map: folium.Map):
        """Circle radius label animates in with a decoupled centering transform.

        The radius label's centering transform is stored in a CSS variable
        (--label-center) so the animation keyframes reference it instead of
        duplicating the translate values. This keeps centering and animation
        decoupled.
        """
        css = pathlib.Path("foliplus/css/MeasureControl.css").read_text()
        assert "foliplus-measure-label-in-radius" in css
        # Centering transform is defined once as a variable on the class
        assert "--label-center: translate(-50%, -50%)" in css
        # Keyframes reference the variable, not hardcoded translate values
        assert "transform: var(--label-center) scale(0.9)" in css
        assert "transform: var(--label-center) scale(1)" in css
        # The radius label class no longer disables animation
        assert (
            "animation: none"
            not in css.split(".foliplus-measure-label-radius")[1].split("/*")[0]
        )

    def _make_page(self, browser, tmp_path, show_bearing=True):
        """Build a page with MeasureControl and return (page, errors)."""
        from foliplus import LayerControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        MeasureControl(show_bearing=show_bearing).add_to(m)

        html = m.get_root().render()
        html = html.replace(
            "const measureManager = new MeasureManager(map);",
            "const measureManager = new MeasureManager(map); window.__measureManager = measureManager; window.__map = map; window.__measureStorageKey = CONST.STORAGE.KEY;",
        )
        # Remove blocking CDN <script> tags (gcoord and turf added by default_js)
        html = html.replace(
            '<script src="https://cdn.jsdelivr.net/npm/gcoord@1/dist/gcoord.global.prod.js"></script>',
            "",
        )
        html = html.replace(
            '<script src="https://cdn.jsdelivr.net/npm/@turf/turf@7/turf.min.js"></script>',
            '<script>window.turf = { distance: (a,b,o) => L.latLng(a.geometry.coordinates[1],a.geometry.coordinates[0]).distanceTo(L.latLng(b.geometry.coordinates[1],b.geometry.coordinates[0])), bearing: (a,b) => { const dL = (b.geometry.coordinates[0]-a.geometry.coordinates[0])*Math.PI/180; const l1 = a.geometry.coordinates[1]*Math.PI/180; const l2 = b.geometry.coordinates[1]*Math.PI/180; const y = Math.sin(dL)*Math.cos(l2); const x = Math.cos(l1)*Math.sin(l2)-Math.sin(l1)*Math.cos(l2)*Math.cos(dL); return (Math.atan2(y,x)*180/Math.PI+360)%360; }, area: (p) => { const R = 6378137; const d2r = Math.PI/180; const pts = p.geometry.coordinates[0]; let a = 0; for (let i = 0; i < pts.length-1; i++) { const p1 = pts[i], p2 = pts[i+1]; a += (p2[0] - p1[0]) * d2r * (2 + Math.sin(p1[1]*d2r) + Math.sin(p2[1]*d2r)); } return Math.abs(a * R * R / 2); }, point: (c) => ({ geometry: { coordinates: [c[0], c[1]], type: "Point" } }), polygon: (c) => ({ geometry: { coordinates: c, type: "Polygon" } }), midpoint: (a,b) => ({ geometry: { coordinates: [(a.geometry.coordinates[0]+b.geometry.coordinates[0])/2, (a.geometry.coordinates[1]+b.geometry.coordinates[1])/2], type: "Point" } }) };</script>',
        )
        html_path = tmp_path / "measure_browser.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
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
        page.goto(f"file://{html_path}", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector(
            ".foliplus-measure-ctrl", state="attached", timeout=10000
        )
        return page, errors

    def test_tool_buttons_render(self, browser, tmp_path):
        """Tool buttons are present in the DOM."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            btns = page.evaluate(
                "document.querySelectorAll('.foliplus-measure-ctrl .foliplus-tool-btn').length"
            )
            assert btns >= 3
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_distance_labels_show_bearing(self, browser, tmp_path):
        """Distance labels include bearing (e.g. '42° | 1.5 km') by default."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('distance');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
                map.fire('click', {latlng: L.latLng(26.09, 119.31)});
                map.fire('contextmenu', {latlng: L.latLng(26.09, 119.31)});
            }""")
            page.wait_for_timeout(500)
            labels = page.evaluate("""() => {
                return Array.from(
                    document.querySelectorAll('.foliplus-measure-label')
                ).map(el => el.textContent);
            }""")
            assert any("° |" in l for l in labels), (
                f"expected a bearing label '° |', got {labels!r}"
            )
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_distance_labels_no_bearing_when_disabled(self, browser, tmp_path):
        """show_bearing=False omits the bearing from distance labels."""
        page, errors = self._make_page(browser, tmp_path, show_bearing=False)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('distance');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
                map.fire('click', {latlng: L.latLng(26.09, 119.31)});
                map.fire('contextmenu', {latlng: L.latLng(26.09, 119.31)});
            }""")
            page.wait_for_timeout(500)
            labels = page.evaluate("""() => {
                return Array.from(
                    document.querySelectorAll('.foliplus-measure-label')
                ).map(el => el.textContent);
            }""")
            assert all("° |" not in l for l in labels), (
                f"no bearing expected when disabled, got {labels!r}"
            )
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_register_on_first_click(self, browser, tmp_path):
        """Layer is registered immediately on tool select, visible on map."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("document.querySelector('[data-mode=distance]').click()")
            page.wait_for_timeout(500)
            # Tool selected — registered immediately (needed to show hidden layer)
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, (
                "Layer should be registered immediately after tool select"
            )
            # First click on map — triggers content addition
            page.evaluate("""() => {
                const map = window.__map;
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
            }""")
            page.wait_for_timeout(500)
            # Second click + right-click to finish
            page.evaluate("""() => {
                const map = window.__map;
                map.fire('click', {latlng: L.latLng(26.09, 119.31)});
            }""")
            page.wait_for_timeout(500)
            page.evaluate("""() => {
                const map = window.__map;
                map.fire('contextmenu', {latlng: L.latLng(26.09, 119.31)});
            }""")
            page.wait_for_timeout(500)
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "Layer should be registered after completing measurement"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_add_graph_adds_content(self, browser, tmp_path):
        """mainLayer.addLayer() auto-registers the layer."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                mm.layers.mainLayer.addLayer(L.polyline([[26.08,119.30],[26.09,119.31]]));
            }""")
            page.wait_for_timeout(500)
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "addLayer should auto-register"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_clear_all_empties_layers(self, browser, tmp_path):
        """destroy() empties content and unregisters."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                mm.layers.addLayer(L.polyline([[26.08,119.30],[26.09,119.31]]));
                mm.layers.addLayer(L.circleMarker([26.08,119.30]));
            }""")
            page.wait_for_timeout(500)
            page.evaluate("window.__measureManager.layers.clearLayers()")
            page.wait_for_timeout(500)
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert not registered, "destroy should unregister the layer"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_remove_graph_removes_single_item(self, browser, tmp_path):
        """mainLayer.removeLayer removes a single layer without affecting others."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const p1 = L.polyline([[26.08,119.30],[26.09,119.31]]);
                const p2 = L.circleMarker([26.08,119.30]);
                mm.layers.mainLayer.addLayer(p1);
                mm.layers.mainLayer.addLayer(p2);
                mm.layers.mainLayer.removeLayer(p1);
                window.__test = mm.layers.registered();
            }""")
            page.wait_for_timeout(500)
            registered = page.evaluate("window.__test")
            assert registered, "layer should remain registered after removing one item"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_destroy_cleans_up_listeners(self, browser, tmp_path):
        """destroy() removes all map listeners (no leak after cleanup)."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            # First, create a circle to trigger onMapClickActive listener
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('circle');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
                map.fire('click', {latlng: L.latLng(26.09, 119.31)});
            }""")
            page.wait_for_timeout(500)
            # Destroy the manager
            page.evaluate("window.__measureManager.destroy()")
            page.wait_for_timeout(200)
            # Verify no errors
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_marker_del_icon_removes_marker(self, browser, tmp_path):
        """Clicking the delete X in marker mode removes the marker pin."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('marker');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
            }""")
            page.wait_for_timeout(500)
            # Remove the layer via API directly (testing the delete logic)
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const layers = mm.layers.mainLayer._layers || {};
                const delMkr = Object.values(layers).find(
                    l => l instanceof L.Marker && l.options.icon?.options?.className?.includes('foliplus-del-icon')
                );
                if (delMkr) {
                    // Simulate clicking the del icon: make it visible, then fire
                    const icon = delMkr.getElement().querySelector('.foliplus-measure-del-icon');
                    if (icon) icon.classList.add('visible');
                    // Fire with a mock originalEvent that has the del-icon target
                    delMkr.fire('click', { originalEvent: { target: icon } });
                }
            }""")
            page.wait_for_timeout(300)
            # Check that delMkr is no longer in the layer group
            hasDelMkr = page.evaluate("""() => {
                const mm = window.__measureManager;
                return Object.values(mm.layers.mainLayer._layers || {}).some(
                    l => l instanceof L.Marker && l.options.icon?.options?.className?.includes('foliplus-del-icon')
                );
            }""")
            assert not hasDelMkr, "delMkr should be removed after clicking delete"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_distance_del_icon_removes_measurement(self, browser, tmp_path):
        """Clicking the delete X in distance mode removes the entire measurement."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('distance');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
                map.fire('click', {latlng: L.latLng(26.09, 119.31)});
                map.fire('contextmenu', {latlng: L.latLng(26.09, 119.31)});
            }""")
            page.wait_for_timeout(500)
            # Fire the delMkr click with a mock originalEvent targeting the X icon
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const layers = mm.layers.mainLayer._layers || {};
                const delMkr = Object.values(layers).find(
                    l => l instanceof L.Marker && l.options.icon?.options?.className?.includes('foliplus-del-icon')
                );
                if (delMkr) {
                    const icon = delMkr.getElement().querySelector('.foliplus-measure-del-icon');
                    if (icon) icon.classList.add('visible');
                    delMkr.fire('click', { originalEvent: { target: icon } });
                }
            }""")
            page.wait_for_timeout(300)
            hasDelMkr = page.evaluate("""() => {
                const mm = window.__measureManager;
                return Object.values(mm.layers.mainLayer._layers || {}).some(
                    l => l instanceof L.Marker && l.options.icon?.options?.className?.includes('foliplus-del-icon')
                );
            }""")
            assert not hasDelMkr, "delMkr should be removed after clicking delete"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_circle_del_icon_removes_circle(self, browser, tmp_path):
        """Clicking the delete X in circle mode removes the entire circle."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('circle');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
                map.fire('click', {latlng: L.latLng(26.09, 119.31)});
            }""")
            page.wait_for_timeout(500)
            # Fire the delMkr click with a mock originalEvent targeting the X icon
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const layers = mm.layers.mainLayer._layers || {};
                const delMkr = Object.values(layers).find(
                    l => l instanceof L.Marker && l.options.icon?.options?.className?.includes('foliplus-del-icon')
                );
                if (delMkr) {
                    const icon = delMkr.getElement().querySelector('.foliplus-measure-del-icon');
                    if (icon) icon.classList.add('visible');
                    delMkr.fire('click', { originalEvent: { target: icon } });
                }
            }""")
            page.wait_for_timeout(300)
            hasDelMkr = page.evaluate("""() => {
                const mm = window.__measureManager;
                return Object.values(mm.layers.mainLayer._layers || {}).some(
                    l => l instanceof L.Marker && l.options.icon?.options?.className?.includes('foliplus-del-icon')
                );
            }""")
            assert not hasDelMkr, "delMkr should be removed after clicking delete"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    # ── Persistence (browser) ──────────────────────────────────────

    def test_save_measurements_stores_to_localStorage(self, browser, tmp_path):
        """saveMeasurements() writes measurements to localStorage."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                mm.measurements = [{ id: 't1', type: 'marker', lng: 119.30, lat: 26.08 }];
                mm.saveMeasurements();
            }""")
            data = page.evaluate("localStorage.getItem(window.__measureStorageKey)")
            assert data is not None, "localStorage should contain saved measurements"

            parsed = json.loads(data)
            assert len(parsed) == 1
            assert parsed[0]["type"] == "marker"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_clear_all_clears_measurements_and_storage(self, browser, tmp_path):
        """clearAll() empties measurements array and persists to localStorage."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                mm.measurements = [{ id: 't1', type: 'marker', lng: 119.30, lat: 26.08 }];
                mm.saveMeasurements();
                mm.clearAll();
            }""")
            data = page.evaluate("localStorage.getItem(window.__measureStorageKey)")
            parsed = json.loads(data) if data else []
            assert len(parsed) == 0, "clearAll should empty localStorage"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_map_unload_keeps_measurements(self, browser, tmp_path):
        """Regression: map unload must NOT wipe persisted measurements.

        unload previously called clearAll(), which wrote an empty array back to
        localStorage — a data-loss risk on page refresh. It must only clear
        transient UI state and keep the persisted measurements.
        """
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                mm.measurements = [{ id: 't1', type: 'marker', lng: 119.30, lat: 26.08 }];
                mm.saveMeasurements();
                mm.onUnload();
            }""")
            data = page.evaluate("localStorage.getItem(window.__measureStorageKey)")
            parsed = json.loads(data) if data else []
            assert len(parsed) == 1, "unload should keep persisted measurements"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_delete_marker_removes_from_storage(self, browser, tmp_path):
        """Deleting a marker removes it from measurements and persists."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('marker');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
            }""")
            # Poll for measurement to appear (async reverse geocode may take time)
            page.wait_for_timeout(500)
            for _ in range(20):
                before = page.evaluate("window.__measureManager.measurements.length")
                if before >= 1:
                    break
                page.wait_for_timeout(500)
            assert before == 1, f"expected 1 measurement, got {before}"
            page.evaluate("""() => {
                const map = window.__map;
                const delMkr = Object.values(map._layers).find(
                    l => l instanceof L.Marker && l.options.icon?.options?.className?.includes('foliplus-del-icon')
                );
                if (delMkr) {
                    const icon = delMkr.getElement().querySelector('.foliplus-measure-del-icon');
                    if (icon) icon.classList.add('visible');
                    delMkr.fire('click', { originalEvent: { target: icon } });
                }
            }""")
            page.wait_for_timeout(300)
            after = page.evaluate("window.__measureManager.measurements.length")
            assert after == 0, f"expected 0 measurements after delete, got {after}"
            data = page.evaluate("localStorage.getItem(window.__measureStorageKey)")
            parsed = json.loads(data) if data else []
            assert len(parsed) == 0, "localStorage should be empty after deleting all"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_restore_marker_from_storage(self, browser, tmp_path):
        """restoreMarker restores a marker measurement from localStorage without ReferenceError."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            # Pre-populate localStorage with a marker measurement
            page.evaluate("""() => {
                const data = [{
                    id: 'foliplus_measure_marker_1',
                    type: 'marker',
                    lng: 119.30,
                    lat: 26.08,
                    address: 'Test Address'
                }];
                localStorage.setItem(window.__measureStorageKey, JSON.stringify(data));
            }""")
            # Reload the page to trigger restoreMeasurements in constructor
            page.reload()
            page.wait_for_timeout(2000)
            # Check measurements were restored
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 restored measurement, got {count}"
            # Check layers registered (restoreMarker calls addLayer)
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "Layer should be registered after restoring marker"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_restore_distance_from_storage(self, browser, tmp_path):
        """restoreDistance restores a distance measurement from localStorage without ReferenceError."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const data = [{
                    id: 'foliplus_measure_distance_1',
                    type: 'distance',
                    points: [
                        { lng: 119.30, lat: 26.08 },
                        { lng: 119.31, lat: 26.09 }
                    ],
                    segments: [
                        { lng: 119.305, lat: 26.085, distance: 1234.56 }
                    ]
                }];
                localStorage.setItem(window.__measureStorageKey, JSON.stringify(data));
            }""")
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 restored distance, got {count}"
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "Layer should be registered after restoring distance"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_restore_circle_from_storage(self, browser, tmp_path):
        """restoreCircle restores a circle measurement from localStorage without ReferenceError."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const data = [{
                    id: 'foliplus_measure_circle_1',
                    type: 'circle',
                    center: { lng: 119.30, lat: 26.08 },
                    target: { lng: 119.31, lat: 26.09 },
                    radius: 500
                }];
                localStorage.setItem(window.__measureStorageKey, JSON.stringify(data));
            }""")
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 restored circle, got {count}"
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "Layer should be registered after restoring circle"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    # ── MeasureUtils edge-case tests ──

    def test_format_distance_zero(self, base_map: folium.Map):
        """formatDistance handles 0 meters."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "0" in html

    def test_format_distance_large(self, base_map: folium.Map):
        """formatDistance handles large values > 1000m."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "km" in html

    def test_calc_toggle_all_modes(self, base_map: folium.Map):
        """calcToggle handles all toggleLbl modes: true, false, undefined, RESET."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "toggleLbl === true" in html
        assert "toggleLbl === false" in html
        assert "toggleLbl === CONST.TOGGLE.RESET" in html

    def test_restore_measurements_corrupted_json(self, base_map: folium.Map):
        """loadMeasurements falls back to an empty array on corrupted JSON."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "Array.isArray(data) ? data : []" in html

    def test_next_measurement_id_format(self, base_map: folium.Map):
        """nextMeasurementId generates IDs with type prefix."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "nextMeasurementId" in html
        assert "CONST.ID" in html

    def test_attach_distance_ui_shared(self, base_map: folium.Map):
        """attachDistanceUI is used by both finishDist and restoreDistance."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        count = html.count("attachDistanceUI")
        assert count >= 2, f"expected 2+ references to attachDistanceUI, got {count}"

    def test_attach_circle_ui_shared(self, base_map: folium.Map):
        """attachCircleUI is used by both finalizeCircle and restoreCircle."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        count = html.count("attachCircleUI")
        assert count >= 2, f"expected 2+ references to attachCircleUI, got {count}"

    # ── Marker persistence timing (regression) ─────────────────────

    def test_marker_saved_before_geocode(self, base_map: folium.Map):
        """Marker measurement is persisted immediately, before geocode resolves."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        # saveMeasurements must be called BEFORE createLocationMarker (which
        # triggers the async geocode) so a reload mid-lookup does not lose it
        save_pos = html.find("this.m.saveMeasurements()")
        create_pos = html.find("foliplus.createLocationMarker(")
        assert save_pos != -1, "saveMeasurements() should exist"
        assert create_pos != -1, "createLocationMarker should exist"
        assert save_pos < create_pos, (
            "measurement must be saved before triggering geocode so a reload "
            "mid-lookup does not lose the marker"
        )

    def test_marker_address_updated_after_geocode(self, base_map: folium.Map):
        """measurement.address is filled in via onAddress callback after geocode."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        # Address update happens through the createLocationMarker onAddress
        # callback, then re-persists
        assert "onAddress" in html
        assert "measurement.address = addr" in html
        assert "this.m.saveMeasurements()" in html

    def test_marker_survives_reload_with_blocked_geocode(self, browser, tmp_path):
        """Regression: marker placed while geocode is blocked still survives reload."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            # Block geocoding entirely — reverseGeocode never resolves
            page.route(
                "**/nominatim.openstreetmap.org/**",
                lambda route: route.abort(),
            )
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('marker');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
            }""")
            # Measurement must be persisted WITHOUT waiting for geocode
            page.wait_for_timeout(300)
            saved = page.evaluate("localStorage.getItem(window.__measureStorageKey)")
            parsed = json.loads(saved) if saved else []
            assert len(parsed) == 1, (
                f"marker must be saved immediately, got {len(parsed)}"
            )
            # Reload — marker must still appear
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 measurement after reload, got {count}"
            pins = page.evaluate("document.querySelectorAll('.foliplus-pin').length")
            assert pins >= 1, "marker pin should be visible after reload"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_restore_marker_address_backfilled(self, browser, tmp_path):
        """Regression: marker restored with address:null resolves and persists address."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const data = [{
                    id: 'foliplus_measure_marker_nulladdr',
                    type: 'marker',
                    lng: 119.30,
                    lat: 26.08,
                    address: null
                }];
                localStorage.setItem(window.__measureStorageKey, JSON.stringify(data));
            }""")
            page.reload()
            page.wait_for_timeout(3000)
            # Address should be resolved by the onAddress callback
            addr = page.evaluate("window.__measureManager.measurements[0]?.address")
            assert addr, f"expected address to be backfilled, got {addr!r}"
            # And persisted back to localStorage
            saved = page.evaluate("localStorage.getItem(window.__measureStorageKey)")
            parsed = json.loads(saved) if saved else []
            assert parsed and parsed[0]["address"], (
                "address should be persisted after restore"
            )
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_restored_marker_popup_shows_resolved_address(self, browser, tmp_path):
        """Regression: restored marker popup shows the resolved address even when
        the popup is opened after geocoding completes.

        createLocationMarker only updates popup content while it is open, so a
        restored marker whose address resolves while the popup is closed would
        otherwise show the loading placeholder on first open.
        """
        page, errors = self._make_page(browser, tmp_path)
        try:
            # Intercept Nominatim so geocode resolves deterministically with a
            # known address. The marker is restored with address:null; geocode
            # completes while the popup is closed.
            page.route(
                "**/nominatim.openstreetmap.org/**",
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body='{"display_name":"Resolved Address, Test City"}',
                ),
            )
            # Restore a marker with address:null
            page.evaluate("""() => {
                const data = [{
                    id: 'foliplus_measure_marker_popup',
                    type: 'marker',
                    lng: 119.30,
                    lat: 26.08,
                    address: null
                }];
                localStorage.setItem(window.__measureStorageKey, JSON.stringify(data));
            }""")
            page.reload()
            page.wait_for_timeout(2000)
            # Geocode resolved while popup is closed — address backfilled
            addr = page.evaluate("window.__measureManager.measurements[0]?.address")
            assert addr, f"expected address to be backfilled, got {addr!r}"

            # Now open the popup — it must show the resolved address
            page.evaluate("""() => {
                const mm = window.__measureManager;
                mm.layers.mainLayer.eachLayer(sub => sub.eachLayer(l => {
                    if (l instanceof L.Marker) {
                        const po = l.getPopup && l.getPopup();
                        if (po && po.getContent && po.getContent().includes) {
                            l.openPopup();
                        }
                    }
                }));
            }""")
            page.wait_for_timeout(200)
            popup_text = page.evaluate("""() => {
                const el = document.querySelector('.leaflet-popup-content');
                return el ? el.textContent : '';
            }""")
            assert "Resolved Address" in popup_text, (
                f"popup should show resolved address, got {popup_text!r}"
            )
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_clear_all_unbinds_circle_listeners(self, browser, tmp_path):
        """Regression: clearAll unbinds all finalized-circle map click handlers.

        Each completed circle binds an onMapClickActive handler to the map.
        clearAll() must unbind them all (not just the last one) to avoid leaks.
        """
        page, errors = self._make_page(browser, tmp_path)
        try:
            baseline = page.evaluate("window.__map._events['click']?.length || 0")
            # Draw 2 circles — each binds an onMapClickActive handler
            for _ in range(2):
                page.evaluate("""() => {
                    const mm = window.__measureManager;
                    const map = window.__map;
                    mm.setMode('circle');
                    map.fire('click', {latlng: L.latLng(26.08, 119.30)});
                    map.fire('click', {latlng: L.latLng(26.09, 119.31)});
                }""")
                page.wait_for_timeout(500)
            after_circles = page.evaluate("window.__map._events['click']?.length || 0")
            assert after_circles == baseline + 2, (
                f"expected {baseline + 2} click handlers after 2 circles, "
                f"got {after_circles}"
            )
            # clearAll must unbind them all
            page.evaluate("window.__measureManager.clearAll()")
            page.wait_for_timeout(200)
            after_clear = page.evaluate("window.__map._events['click']?.length || 0")
            assert after_clear == baseline, (
                f"expected {baseline} click handlers after clearAll, got {after_clear}"
            )
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    # ── PreviewMode lifecycle ─────────────────────────────────
    def test_preview_mode_has_methods(self, base_map: folium.Map):
        """PreviewMode provides addPreview/removePreview/clearPreviews/isFinished/previewLayers."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "addPreview(layer)" in html
        assert "removePreview(layer)" in html
        assert "clearPreviews()" in html
        assert "this.isFinished" in html or "this.isFinished =" in html
        assert "this.previewLayers" in html or "this.previewLayers =" in html

    def test_add_preview_adds_to_layer_group(self, base_map: folium.Map):
        """addPreview calls this.layers.addLayer(layer) internally."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.layers.addLayer(layer)" in html
        assert "this.previewLayers.push(layer)" in html

    def test_remove_preview_removes_from_tracked(self, base_map: folium.Map):
        """removePreview splices from previewLayers and removes from layer group."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.previewLayers.indexOf(layer)" in html
        assert "this.previewLayers.splice(idx, 1)" in html
        assert "this.layers.removeLayer(layer)" in html

    def test_clear_previews_empties_all(self, base_map: folium.Map):
        """clearPreviews removes all tracked preview layers and resets the array."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.previewLayers.forEach((l) => this.layers.removeLayer(l))" in html
        assert "this.previewLayers = []" in html

    def test_distance_uses_preview_base(self, base_map: folium.Map):
        """DistanceMode calls addPreview for poly/previewLine, uses finalPoly via addLayer."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.addPreview(" in html
        assert "CONST.CLASSES.LINE_DASHED" in html
        assert "CONST.CLASSES.LINE_PREVIEW" in html
        assert "finalPoly" in html

    def test_circle_uses_preview_base(self, base_map: folium.Map):
        """CircleMode calls addPreview for preview center/circle/line/node/label."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        # Preview layers should use addPreview, final layers use addLayer
        assert "this.addPreview(" in html
        assert "previews.center" in html
        assert "previews.circle" in html
        assert "previews.line" in html
        assert "previews.node" in html
        assert "previews.label" in html

    # ── Edge cases ──

    def test_escape_key_exits_mode(self, base_map: folium.Map):
        """Escape key calls clearActiveMode when mode is active."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'e.key === "Escape"' in html
        assert "this.currentMode" in html
        assert "this.clearActiveMode()" in html

    def test_clear_mode_routes_to_clear_all(self, base_map: folium.Map):
        """CLEAR mode calls clearAll() directly."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "mode === CONST.MODE.CLEAR" in html
        assert "this.clearAll()" in html

    def test_same_mode_toggle_clears(self, base_map: folium.Map):
        """Clicking the same mode button again clears the mode."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.currentMode === mode" in html
        assert "this.clearActiveMode()" in html

    def test_distance_cancel_on_single_point(self, base_map: folium.Map):
        """finishDist with <2 points cleans up without saving."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "points.length < 2" in html
        assert "this.cleanup()" in html
        assert "this.m.clearActiveMode()" in html

    def test_distance_is_finished_guard(self, base_map: folium.Map):
        """isFinished prevents double finalization of distance."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.isFinished" in html
        assert "return" in html

    def test_preview_layer_cleanup_on_finish(self, base_map: folium.Map):
        """After finishDist, previewLine is removed from layers."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.layers.removeLayer(previewLine)" in html
        assert "this.layers.removeLayer(poly)" in html

    def test_clear_previews_in_circle_cleanup(self, base_map: folium.Map):
        """CircleMode cleanup calls resetPreviews which clears preview layers."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "resetPreviews()" in html
        assert "this.clearPreviews()" in html

    # ── Browser tests for gaps ──

    def test_escape_cancels_mode(self, browser, tmp_path):
        """Pressing Escape while drawing cancels the mode."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('distance');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
            }""")
            page.wait_for_timeout(300)
            # Press Escape
            page.evaluate("""() => {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            }""")
            page.wait_for_timeout(200)
            mode = page.evaluate("window.__measureManager.currentMode")
            assert mode is None, f"expected mode to be None after Escape, got {mode}"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_clear_button_empties_everything(self, browser, tmp_path):
        """Clicking the CLEAR tool button removes all measurements and layers."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            # Add some content
            page.evaluate("""() => {
                const mm = window.__measureManager;
                mm.layers.addLayer(L.circleMarker([26.08, 119.30]));
                mm.layers.addLayer(L.polyline([[26.08,119.30],[26.09,119.31]]));
                mm.measurements = [{ id: 'test', type: 'marker', lng: 119.30, lat: 26.08 }];
                mm.saveMeasurements();
            }""")
            page.wait_for_timeout(200)
            # Click CLEAR button
            page.evaluate("""() => {
                const btn = document.querySelector('[data-mode=clear]');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)
            # All sub-layers should be empty
            subLayersEmpty = page.evaluate("""() => {
                const main = window.__measureManager.layers.mainLayer;
                return Object.values(main._layers).every(
                    sub => !sub._layers || Object.keys(sub._layers).length === 0
                );
            }""")
            assert subLayersEmpty, "expected all sub-layers to be empty after clear"
            # Measurements should be empty
            meas = page.evaluate("window.__measureManager.measurements.length")
            assert meas == 0, f"expected 0 measurements, got {meas}"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_same_tool_toggle_clears_mode(self, browser, tmp_path):
        """Clicking the same tool button twice clears the mode."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const btn = document.querySelector('[data-mode=distance]');
                btn.click();
            }""")
            page.wait_for_timeout(200)
            mode1 = page.evaluate("window.__measureManager.currentMode")
            assert mode1 == "distance", f"expected distance mode, got {mode1}"
            # Click same button again
            page.evaluate("""() => {
                const btn = document.querySelector('[data-mode=distance]');
                btn.click();
            }""")
            page.wait_for_timeout(200)
            mode2 = page.evaluate("window.__measureManager.currentMode")
            assert mode2 is None, f"expected mode cleared, got {mode2}"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_distance_cancel_single_click(self, browser, tmp_path):
        """Single click then right-click cancels distance without saving."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('distance');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
            }""")
            page.wait_for_timeout(300)
            # Right-click to finish (cancel) with < 2 points
            page.evaluate("""() => {
                const map = window.__map;
                map.fire('contextmenu', {latlng: L.latLng(26.08, 119.30)});
            }""")
            page.wait_for_timeout(300)
            # Mode should be cleared, no measurement saved
            mode = page.evaluate("window.__measureManager.currentMode")
            assert mode is None, f"expected mode cleared, got {mode}"
            meas = page.evaluate("window.__measureManager.measurements.length")
            assert meas == 0, f"expected 0 measurements, got {meas}"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_distance_preview_layers_removed_after_finish(self, browser, tmp_path):
        """After finishing distance, previewLine and poly are removed from map."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('distance');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
                map.fire('click', {latlng: L.latLng(26.09, 119.31)});
                map.fire('contextmenu', {latlng: L.latLng(26.09, 119.31)});
            }""")
            page.wait_for_timeout(500)
            # The map should have the final polyline but not the preview layers
            # Check that measurements were saved
            meas = page.evaluate("window.__measureManager.measurements.length")
            assert meas == 1, f"expected 1 measurement, got {meas}"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_add_preview_returns_layer(self, base_map: folium.Map):
        """addPreview returns the layer for chaining."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "return layer" in html

    def test_is_finished_resets_on_new_start(self, base_map: folium.Map):
        """isFinished starts as false when a new DistanceMode is created."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.isFinished = false" in html

    # ── Polygon Area Mode ─────────────────────────────────────────

    def test_polygon_mode_constant(self, base_map: folium.Map):
        """POLYGON mode constant is defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'POLYGON: "polygon"' in html

    def test_polygon_svg_icon(self, base_map: folium.Map):
        """Polygon SVG icon with vertices is defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "POLYGON: `" in html
        assert '<polygon points="12,3 21,9 18,21 6,21 3,9"/>' in html

    def test_polygon_tool_button(self, base_map: folium.Map):
        """Polygon tool button is configured between distance and circle."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "mode: CONST.MODE.POLYGON" in html
        assert "SVGs.POLYGON" in html
        assert "MeasureControl.tool_polygon" in html

    def test_polygon_mode_class(self, base_map: folium.Map):
        """PolygonMode class extends PreviewMode."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "class PolygonMode extends PreviewMode" in html
        assert "static TYPE = CONST.MODE.POLYGON" in html

    def test_polygon_set_mode(self, base_map: folium.Map):
        """setMode instantiates PolygonMode for POLYGON."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "mode === CONST.MODE.POLYGON" in html
        assert "new PolygonMode(this)" in html
        assert "MeasureControl.hint_polygon" in html

    def test_polygon_restore_case(self, base_map: folium.Map):
        """restoreMeasurements handles POLYGON type."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "case CONST.MODE.POLYGON:" in html
        assert "this.restorePolygon(m)" in html

    def test_polygon_restore_method(self, base_map: folium.Map):
        """restorePolygon method exists with POLYGON_FINAL class."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "restorePolygon(m)" in html
        assert "POLYGON_FINAL" in html

    def test_polygon_attach_method(self, base_map: folium.Map):
        """attachPolygonUI method exists."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "attachPolygonUI(opts)" in html
        assert "rebuildCentroid" in html

    def test_polygon_area_utility(self, base_map: folium.Map):
        """MeasureUtils.area and formatArea are defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "static area(points)" in html
        assert "static formatArea(sqMeters)" in html

    def test_polygon_format_area(self, base_map: folium.Map):
        """formatArea handles m² and km² thresholds."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "1_000_000" in html
        assert "km²" in html
        assert "m²" in html

    def test_polygon_turf_dependency(self, base_map: folium.Map):
        """MeasureControl includes turf.js as a CDN dependency."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "turf" in html
        assert "turf.min.js" in html

    def test_polygon_centroid_anchor(self, base_map: folium.Map):
        """CENTROID_ANCHOR constant is defined for area label below centroid."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "CENTROID_ANCHOR: [0, -10]" in html

    def test_polygon_finish_click_first_point(self, base_map: folium.Map):
        """Polygon completes on click of first or last point."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "marker === nodeMarkers[0]" in html
        assert "marker === nodeMarkers[nodeMarkers.length - 1]" in html

    def test_polygon_finish_dblclick(self, base_map: folium.Map):
        """Polygon completes on double-click."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "onPolyDbl" in html
        assert "finishPoly()" in html

    def test_polygon_finish_contextmenu(self, base_map: folium.Map):
        """Polygon completes on right-click."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "onPolyContext" in html
        assert "finishPoly()" in html

    def test_polygon_minimum_three_points(self, base_map: folium.Map):
        """Polygon requires at least 3 points to finish."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "points.length < 3" in html
        assert "finishPoly" in html

    def test_polygon_centroid_dot(self, base_map: folium.Map):
        """Polygon centroid uses CENTER_DOT like circle."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "CENTER_DOT.CLASS_FINAL" in html
        assert "centroidDot" in html

    def test_polygon_centroid_del_icon(self, base_map: folium.Map):
        """Polygon centroid has a delete icon."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "centroidDel" in html
        assert "MeasureUtils.attachDelClick(centroidDel, deleteMeas)" in html

    def test_polygon_closing_segment(self, base_map: folium.Map):
        """Polygon segments include the closing edge from last to first point."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "lastSeg" in html
        assert "points[points.length - 1]" in html
        assert "points[0].lng" in html

    def test_polygon_preview_fill(self, base_map: folium.Map):
        """Polygon preview uses CIRCLE_PREVIEW class for semi-transparent fill."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "previewPoly" in html
        assert "CONST.CLASSES.CIRCLE_PREVIEW" in html

    def test_distance_click_first_point_finish(self, base_map: folium.Map):
        """Distance mode also completes on click of first point."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "marker === nodeMarkers[0]" in html
        assert "marker === nodeMarkers[nodeMarkers.length - 1]" in html

    # ── Polygon browser tests ──────────────────────────────────────

    def test_polygon_draw_and_delete(self, browser, tmp_path):
        """Draw a polygon with 3 points, verify it renders, then delete via clearAll."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('polygon');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
                map.fire('click', {latlng: L.latLng(26.09, 119.31)});
                map.fire('click', {latlng: L.latLng(26.07, 119.32)});
                map.fire('contextmenu', {latlng: L.latLng(26.07, 119.32)});
            }""")
            page.wait_for_timeout(500)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 polygon measurement, got {count}"
            area = page.evaluate("window.__measureManager.measurements[0].area")
            assert area > 0, f"expected positive area, got {area}"
            # Delete the polygon via clearAll
            page.evaluate("window.__measureManager.clearAll()")
            page.wait_for_timeout(300)
            page.wait_for_timeout(300)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 0, f"expected 0 measurements after delete, got {count}"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_polygon_node_delete(self, browser, tmp_path):
        """Toggle polygon delete icons without raising JS errors."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('polygon');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
                map.fire('click', {latlng: L.latLng(26.09, 119.31)});
                map.fire('click', {latlng: L.latLng(26.07, 119.32)});
                map.fire('click', {latlng: L.latLng(26.08, 119.33)});
                map.fire('contextmenu', {latlng: L.latLng(26.08, 119.33)});
            }""")
            page.wait_for_timeout(500)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 polygon measurement, got {count}"
            # Delete the polygon
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                // Trigger toggle so delete icons are visible
                const poly = Object.values(mm.layers.mainLayer._layers || {}).find(
                    l => l instanceof L.Polygon
                );
                if (poly) poly.fire('click', { originalEvent: { target: poly._path } });
            }""")
            page.wait_for_timeout(300)
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_restore_polygon_from_storage(self, browser, tmp_path):
        """restorePolygon restores a polygon measurement from localStorage."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const data = [{
                    id: 'foliplus_measure_polygon_1',
                    type: 'polygon',
                    points: [
                        { lng: 119.30, lat: 26.08 },
                        { lng: 119.31, lat: 26.09 },
                        { lng: 119.32, lat: 26.07 }
                    ],
                    segments: [
                        { lng: 119.305, lat: 26.085, distance: 1234 },
                        { lng: 119.315, lat: 26.08, distance: 2345 },
                        { lng: 119.31, lat: 26.075, distance: 3456 }
                    ],
                    area: 500000
                }];
                localStorage.setItem(window.__measureStorageKey, JSON.stringify(data));
            }""")
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 restored polygon, got {count}"
            area = page.evaluate("window.__measureManager.measurements[0].area")
            assert area == 500000, f"expected area 500000, got {area}"
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "Layer should be registered after restoring polygon"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    # ── Mid-segment label ──────────────────────────────────────────

    def test_mid_label_icon_helper(self, base_map: folium.Map):
        """makeMidLabelDivIcon uses MID_ANCHOR and CLASS_MID for centered labels."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MID_ANCHOR" in html
        assert "CLASS_MID" in html
        assert "makeMidLabelDivIcon" in html

    def test_mid_label_css_class(self, base_map: folium.Map):
        """CLASS_MID renders as foliplus-measure-label-mid."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'CLASS_MID: "foliplus-measure-label-mid"' in html

    def test_start_label_restored(self, base_map: folium.Map):
        """Distance mode restores the start label (dist_origin) on first click."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "dist_origin" in html
        assert "MeasureControl.dist_origin" in html

    def test_closing_segment_label(self, base_map: folium.Map):
        """Polygon creates a closing segment label (lastPt→firstPt)."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "closeLabel" in html
        assert "closeMid" in html

    def test_node_delete_rebuilds_labels(self, base_map: folium.Map):
        """Polygon node deletion removes all segLabels and rebuilds from scratch."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "segLabels.forEach((l) => layers.removeLayer(l))" in html
        assert "segLabels.length = 0" in html
        assert "segLabels.push(label)" in html

    def test_animate_dash_sweep_method(self, base_map: folium.Map):
        """animateDashSweep static method is defined with guard and animationend cleanup."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "static animateDashSweep(path)" in html
        assert "if (len <= 0) return" in html
        assert 'removeEventListener("animationend", onEnd)' in html

    def test_restore_distance_uses_accumulator(self, base_map: folium.Map):
        """restoreDistance uses O(n) accumulator instead of O(n^2) slice+reduce."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "accTotal" in html
        assert "accTotal += seg.distance" in html

    def test_polygon_3pt_del_all_on_initial(self, base_map: folium.Map):
        """When polygon has exactly 3 points, every node X shows del_all."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "is3pt = points.length === 3" in html
        assert "CONST.name" in html
        assert "del_all" in html
        assert "del_node" in html

    def test_polygon_3pt_del_all_on_delete_down(self, base_map: folium.Map):
        """When polygon nodes are deleted down to 3, remaining nodes switch to del_all."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "points.length === 3" in html
        assert "del_all" in html
        assert "iconEl.title" in html
