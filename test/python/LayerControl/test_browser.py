"""Browser tests for foliplus.LayerControl."""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path

import folium
import pytest
from conftest import (
    _js,
    assert_config_value,
    assert_locale,
    heatmap_ready,
    make_browser_page,
    panel_ready,
    read_css,
    read_css_dir,
    render,
    render_control,
    use_page,
    use_raw_page,
)
from folium import Element

from foliplus import HeatmapControl, LayerControl

from .helper import _expand_panel, _tiny_png, _write_html


class TestLayerControlBrowser:
    """Browser-level interaction checks for drag/drop feedback."""

    @staticmethod
    def _make_page(browser, tmp_path, *layers, slug="lc", **ctrl_kwargs):
        """Create a map with LayerControl, render, and return (page, errors).

        ``ctrl_kwargs`` are forwarded to ``LayerControl()`` so a browser test can
        exercise a non-default parameter (e.g. ``collapse_on_outside=True``).
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl(**ctrl_kwargs).add_to(m)
        for layer in layers:
            layer.add_to(m)
        html = m.get_root().render()
        # Expose the control instance for re-entry tests (dev build keeps names).
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found in rendered HTML"
        page, errors = make_browser_page(browser, tmp_path, html, slug)
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        return page, errors

    @staticmethod
    def _sample_token(page, name: str) -> str:
        """Computed color of a design token — never hardcode a hex/rgb."""
        return page.evaluate(_js("LayerControl/sample_token"), name)

    @staticmethod
    def _sample_neutral0(page):
        """Computed color of `var(--foliplus-neutral-0)` — never hardcode a hex/rgb."""
        return TestLayerControlBrowser._sample_token(page, "--foliplus-neutral-0")

    @staticmethod
    def _panel_open(page, selector: str) -> bool:
        """True while the panel at *selector* is expanded, not collapsed."""
        return page.evaluate(_js("LayerControl/panel_open"), selector)

    def test_menu_shell_keeps_design_padding_under_bootstrap(self, browser, tmp_path):
        """T266: the layer more-menu shell keeps its design padding on a host
        Bootstrap page.

        Bootstrap ships an unlayered `ol,ul{padding-left:2rem}` reset. After
        #568 wrapped foliplus CSS in @layer, that reset outranked the shell at
        any specificity and pushed the icon column inward. T266 reverted the
        @layer wrap, restoring the specificity order: the shell selector
        (0,2,0) beats `ul` (0,0,1), so the icon column stays flush with the
        shell's left padding. This pins the computed padding-left in the real
        folium page (Bootstrap included), which the plain unit tests cannot
        see.
        """
        layer = folium.FeatureGroup(name="Menu shell", overlay=True, show=True)
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="menu_shell_padding"
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(400)
            page.evaluate(_js("LayerControl/click_first_more_btn"))
            page.wait_for_selector(
                ".foliplus-layer-more-menu.open", state="attached", timeout=5000
            )
            padding_left = page.evaluate(_js("LayerControl/read_more_menu_padding"))
            assert padding_left == "0px", (
                f"menu shell padding-left drifted under Bootstrap: {padding_left!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_cross_group_drag_shows_hint(self, browser, tmp_path):
        """Dragging overlay toward base group should show blocked hint."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        base = folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False)
        with use_page(self._make_page, browser, tmp_path, overlay, base) as (
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
            page.wait_for_selector(
                '.foliplus-layer-item[data-layer-type="base"]',
                state="attached",
                timeout=5000,
            )

            ok = page.evaluate(_js("LayerControl/dispatch_cross_group_dragover"))
            assert ok, "Failed to dispatch simulated cross-group dragover"

            page.wait_for_selector(
                ".foliplus-hint-LayerControl", state="attached", timeout=5000
            )
            hint_text = page.evaluate(_js("LayerControl/read_hint_text"))
            assert ("same group" in hint_text.lower()) or ("同分组" in hint_text)

    def test_remove_readd_restores_layer_api(self, browser, tmp_path):
        """Re-add after removeControl upgrades LayerAPI back to full and re-attaches panel."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, errors):
            panel_ready(page)
            state = page.evaluate(_js("LayerControl/destroy_readd"))
            assert state["afterRemoveStub"] is True
            assert state["afterAddFull"] is True
            assert state["panelAttached"] is True
            panel_ready(page)  # rebuilt panel completes its init pass again
            assert not errors, f"JS errors: {errors}"

    def test_remove_readd_leaves_no_listener_residue(self, browser, tmp_path):
        """N=3 remove → add cycles must not grow map._events listener sum.

        Hard regression gate: baseline round[0] is captured right after the
        initial addControl (harness already ran that in page setup);
        rounds[1] and rounds[2] follow remove → add. Any drift — whether on
        round[0] or in a later round — fails the assertion.

        The gate is what caught the `dismissFocus` → `ensureModes` first-call
        side effect leaking a `map.on('unload', ...)` handler at round[1]
        (fix in foliplus/js/LayerControl/ui/focus/index.ts). See the probe comment
        in test/js/browser/LayerControl/probe_listener_residue.js for the
        historical note.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, errors):
            panel_ready(page)
            state = page.evaluate(_js("LayerControl/probe_listener_residue"))
            rounds = state["rounds"]
            assert len(rounds) == 3, f"expected 3 rounds, got {rounds!r}"
            for i, n in enumerate(rounds[1:], start=1):
                assert n == rounds[0], (
                    f"LayerControl: map._events listener sum grew on round {i}: "
                    f"{rounds!r}"
                )
            panel_ready(page)
            assert not errors, f"JS errors: {errors}"

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

    def test_create_managed_layers_api(self, browser, tmp_path):
        """layers() returns expected convenience methods."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            api = page.evaluate(_js("LayerControl/create_layers_api"))
            assert api is not None, "LayerAPI not found"
            assert api["hasClearLayers"], "clearLayers missing"
            assert api["hasRegister"], "register missing"
            assert api["hasUnregister"], "unregister missing"
            assert api["hasRegistered"], "registered missing"
            assert api["hasMainLayer"], "mainLayer missing"
            assert api["hasBringToFront"], "bringToFront missing"

    def test_add_graph_sets_pane(self, browser, tmp_path):
        """addGraph sets pane on the layer and calls register."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/add_graph_sets_pane"))
            assert result is not None
            assert result["pane"] == "__pane_test_graph__", f"got {result['pane']}"
            assert result["hasRenderer"] is True, "renderer not set"
            assert result["registered"] is True, "not registered after addLayer"

    def test_clear_all_unregisters(self, browser, tmp_path):
        """clearAll clears content and unregisters the layer."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/clear_all_unregisters"))
            assert result is not None
            assert result["beforeRegistered"] is True
            assert result["afterRegistered"] is False

    def test_geojson_group_pins_children_to_declared_pane(self, browser, tmp_path):
        """A GeoJSON group's child paths render into the declared data pane.

        ``addLayer`` writes ``options.pane`` on the node it is handed, and
        Leaflet ignores a group's pane for its children — each child joins the
        map on its own.  Without the recursive pin the shapes would draw into
        the map's default pane even though every option says otherwise.
        """
        with use_page(self._make_page, browser, tmp_path, slug="geojson_pane") as (
            page,
            errors,
        ):
            result = page.evaluate(_js("LayerControl/geojson_group_pins_children_pane"))
            assert result is not None, "LayerAPI not found"
            assert result["paneExists"], f"declared pane was never created: {result}"
            assert result["groupPane"] == "__geojson_pane__", result
            assert len(result["kids"]) == 2, f"unexpected child count: {result}"
            for kid in result["kids"]:
                assert kid["pane"] == "__geojson_pane__", f"child not pinned: {kid}"
                assert kid["hasRendererOpt"], f"child has no renderer option: {kid}"
                assert kid["hasRenderer"], f"child has no _renderer: {kid}"
                assert kid["isPath"], f"child has no renderer container: {kid}"
                # DOM truth: the SVG container's parent must be the declared pane element.
                assert kid["inDeclaredPane"] is True, (
                    f"child renders outside declared pane "
                    f"(parent: {kid['parentTag']}."
                    f"{kid['parentClass']}): {kid}"
                )
            assert not errors, f"JS errors: {errors}"

    def test_icon_svg_payload_never_reaches_dom(self, browser, tmp_path):
        """A hostile iconSvg survives the innerHTML sink as inert markup only.

        ``iconSvg`` is the one piece of third-party-supplied HTML in the layer
        model — callers of ``LayerAPI.registerLayer`` / ``createLayers`` hand it
        in unchecked and it lands in an ``innerHTML`` sink on the type-icon
        column.  The payload carries three independent vectors: an ``onload``
        handler on the svg root, a nested ``<script>``, and an ``<img>``
        smuggled in as a second root (which must not even survive as an
        element).
        """
        with use_page(self._make_page, browser, tmp_path, slug="xss_icon") as (
            page,
            _,
        ):
            result = page.evaluate(_js("LayerControl/icon_svg_sanitized"))
            assert result is not None, "LayerAPI not found"
            assert result["ctrlPresent"], "layer control not mounted"

            assert not any(result["leaked"]), (
                f"executable payload ran: {result['leaked']}"
            )
            assert result["probe"] is not None, "probe row never rendered"
            assert result["probe"]["scripts"] == 0, result["probe"]
            assert result["probe"]["imgs"] == 0, result["probe"]
            assert "onload=" not in result["probe"]["html"], result["probe"]
            assert "<script" not in result["probe"]["html"], result["probe"]
            # The rect is presentation and must survive; the payload must not.
            assert result["probe"]["svgs"] == 1, result["probe"]
            assert "<rect" in result["probe"]["html"], result["probe"]

            # A namespace declaration is structural, not content: it has to
            # survive, otherwise Chromium redeclares the SVG namespace on every
            # element when serialising and a `class` attribute stops matching its
            # CSS rule. This is a real-browser serialisation property — jsdom
            # writes both shapes identically — so the assertion only exists here.
            assert result["spin"] is not None, "spinner row never rendered"
            assert result["spin"]["xmlnsCount"] == 1, result["spin"]
            assert result["spin"]["class"] == "foliplus-spin", result["spin"]
            assert result["spin"]["matches"] is True, result["spin"]

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

    def test_add_label_sets_pane(self, browser, tmp_path):
        """addLabel sets pane on the marker."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/add_label_sets_pane"))
            assert result is not None
            assert result["pane"] == "__test_label_pane__", f"got {result['pane']}"
            assert result["registered"] is True

    def test_annotation_canvas_draws(self, browser, tmp_path):
        """Enabling labels draws text onto the shared annotation canvas."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/annotation_canvas_draws"))
            assert result is not None, "annotation manager or LayerAPI not found"
            assert result["canvas"] is True, f"canvas not created: {result}"
            assert result["opaque"] > 0, "canvas has no drawn pixels"
            assert not errors, f"JS errors: {errors}"

    def test_annotation_overlap_hides(self, browser, tmp_path):
        """Two labels whose halo-inclusive boxes overlap collapse to the first."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/annotation_overlap_hides"))
            assert result is not None, "annotation manager or LayerAPI not found"
            assert result["canvas"] is True, f"canvas not created: {result}"
            assert result["aOpaque"] > 0, "first (kept) label was not drawn"
            assert result["bOpaque"] == 0, "second (hidden) label was drawn"
            assert not errors, f"JS errors: {errors}"

    def test_annotation_click_through(self, browser, tmp_path):
        """The canvas ignores pointer events so clicks land on the map/feature.

        The canvas opts out by carrying ``foliplus-canvas-layer`` (the
        decoration-canvas marker), which the base ``.foliplus-layer-pane``
        rule turns into ``pointer-events: none`` — no inline style. The
        computed value is what we assert, not the inline attribute.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            page.evaluate(_js("LayerControl/annotation_canvas_draws"))
            result = page.evaluate(_js("LayerControl/annotation_click_through"))
            assert result is not None and result["canvas"] is True, result
            assert result["pointerEvents"] == "none", result
            assert result["decorationClass"] is True, (
                "annotation canvas must carry foliplus-canvas-layer"
            )
            assert result["hitIsCanvas"] is False, (
                "annotation canvas intercepted the click"
            )
            assert not errors, f"JS errors: {errors}"

    def test_label_canvas_click_through(self, browser, tmp_path):
        """A decoration canvas lets clicks reach the layer below, while a
        marker in the same pane keeps its own click handler.

        A label pane holds one full-bleed canvas.  It paints decoration rather
        than receiving hits, so it declares ``pointer-events: none`` on itself
        — the shape ``AnnotationCanvas`` uses.  Without that it would swallow
        every click over the map and the data layer underneath would stop
        being clickable.  Nothing pane-level has to opt in: the decision
        belongs to the element that paints.

        The pane's own ``pointer-events: none`` (every foliplus pane carries
        it) must not kill descendants that have their own hit area:
        ``pointer-events`` is per-element, not inherited.  A marker in the
        pane keeps its ``pointer-events: auto`` wrapper and its click handler
        stays live.  This is the mechanism MeasureControl's segment labels
        rely on.
        """
        with use_page(self._make_page, browser, tmp_path, slug="label_canvas") as (
            page,
            errors,
        ):
            result = page.evaluate(_js("LayerControl/label_canvas_click_through"))
            assert result is not None, "LayerAPI not found"
            assert result["ready"] is True, f"fixture not ready: {result}"
            assert result["labelPointerEvents"] == "none", result
            assert result["dataPointerEvents"] == "none", (
                f"data pane should also refuse hits (focus.css sets "
                f"pointer-events:none on all foliplus-layer-pane): {result}"
            )
            # Data layer underneath: the polygon is the hit target at a point
            # away from the marker, and its click handler fires.
            assert result["polyHitIsPoly"] is True, (
                f"label canvas swallowed the hit: {result}"
            )
            assert result["polyHitInLabelPane"] is False, result
            assert result["polyClicked"] is True, (
                "the data feature did not receive the click"
            )
            # Marker in the pane: its own wrapper is the hit target
            # (re-enabled by its own pointer-events:auto), and its click
            # handler fires.  Without this the segment-label affordance would
            # be silently lost.
            assert result["markerHitIsIcon"] is True, (
                f"marker did not receive the hit: {result}"
            )
            assert result["markerHitInLabelPane"] is True, result
            assert result["labelMarkerClicked"] is True, (
                f"the marker in the pane lost its click handler: {result}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_clickable_data_canvas(self, browser, tmp_path):
        """A canvas in a pane receives clicks.

        ``pointer-events`` inherits, so everything inside the ``none`` pane
        starts off unable to take a hit.  A canvas is the surface its owner
        paints into — Leaflet hit-tests a canvas renderer by coordinate, not
        by element — so the CSS switches canvases back on.  A canvas that
        paints decoration instead opts out on itself.
        """
        with use_page(self._make_page, browser, tmp_path, slug="clickable_data") as (
            page,
            errors,
        ):
            result = page.evaluate(_js("LayerControl/clickable_data_canvas"))
            assert result is not None, "LayerAPI not found"
            assert result["ready"] is True, f"fixture not ready: {result}"
            assert result["pointerEvents"] == "none", (
                "the pane div itself stays pointer-events:none (it is a "
                f"container, not a hit target): {result}"
            )
            assert result["canvasPointerEvents"] == "auto", (
                "a canvas in a pane must be re-enabled — the pane is "
                f"pointer-events:none and the value inherits: {result}"
            )
            # Reachability first: the browser's own hit test has to land on
            # the canvas, and then a real mouse click at those coordinates
            # has to reach it.  A dispatch straight at the element would pass
            # even when nothing can reach it — the hole the pane-level
            # pointer-events bug slipped through.
            assert result["hitIsCanvas"] is True, (
                f"the canvas is not the hit target: {result}"
            )
            page.click("#foliplus-probe-clickable-canvas")
            assert page.evaluate(_js("LayerControl/read_clickable_canvas_hits")) == 1, (
                f"the real click never reached the canvas: {result}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_pane_svg_does_not_capture_the_map(self, browser, tmp_path):
        """The SVG renderer inside a foliplus pane must not swallow the map.

        An inline ``<svg>`` carrying ``pointer-events`` is hit over its whole
        box, not only where it paints.  Every foliplus pane holds one and each
        covers the map, so an SVG left at ``auto`` takes every event meant for
        a layer painted below it — geometry hover/click dies and the cursor
        sticks at the inherited ``grab``.

        ``pointer-events`` on the svg has to stay ``none``; the paths are
        reached through ``.leaflet-interactive`` instead.  Leaflet never sets
        it on the svg for exactly this reason.
        """
        with use_page(self._make_page, browser, tmp_path, slug="pane_svg") as (
            page,
            errors,
        ):
            result = page.evaluate(_js("LayerControl/pane_svg_does_not_capture"))
            assert result is not None, "LayerAPI not found"
            assert result["ready"] is True, f"fixture not ready: {result}"

            assert result["svgPointerEvents"] == "none", (
                "the pane's SVG renderer must not be a hit target, or it "
                f"captures the whole map: {result}"
            )
            assert result["panePointerEvents"] == "none", result

            # On the geometry: the path is the target, with the interactive
            # cursor, and its click handler stays live.
            assert result["pathIsInteractive"] is True, result
            assert result["pathPointerEvents"] == "auto", result
            assert result["onHitIsPath"] is True, (
                f"geometry is not the hit target on itself: {result}"
            )
            assert result["onHitCursor"] == "pointer", (
                f"geometry does not show the interactive cursor: {result}"
            )
            assert result["clicked"] is True, (
                f"the feature did not receive the click: {result}"
            )

            # Off the geometry: nothing of the foliplus pane may be the
            # target.  This is the regression — the pane's SVG used to take
            # every point of the map.
            assert result["offHitIsSvg"] is False, (
                f"the pane's SVG swallowed a point off the geometry: {result}"
            )
            assert result["offHitInPane"] is False, (
                f"a foliplus pane swallowed a point off the geometry: {result}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_annotation_stays_put_on_pan(self, browser, tmp_path):
        """Panning must not drift the labels: the canvas cancels mapPane's move."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/annotation_pan_stable"))
            assert result is not None and result["canvas"] is True, result
            assert result["beforeLeft"] == result["afterLeft"], result
            assert result["beforeTop"] == result["afterTop"], result
            assert not errors, f"JS errors: {errors}"

    def test_annotation_labels_follow_layer_visibility(self, browser, tmp_path):
        """Hiding a layer drops its labels; showing it brings them back."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/annotation_hidden_layer"))
            assert result is not None, result
            assert result["before"] > 0, result
            assert result["hidden"] == 0, result
            assert result["shown"] > 0, result
            assert not errors, f"JS errors: {errors}"

    def test_annotation_each_layer_own_pane_ordered_by_layer(self, browser, tmp_path):
        """Each labeled layer gets its own canvas pane, z-ordered with its layer.

        The pane goes through ``PaneManager.ensurePane`` (the single entry
        point for owned panes), so it carries the base ``foliplus-layer-pane``
        class alongside the annotation role marker — that is what makes the
        pane's interaction rules in focus.css apply without a special case.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/annotation_multi_layer"))
            assert result is not None and result["canvas"] is True, result
            # One pane + one canvas per labeled layer — not a shared canvas.
            assert result["canvasCount"] == 2, result
            assert result["opaqueA"] > 0, result
            assert result["opaqueB"] > 0, result
            # Layer B is above layer A in the panel (createLayers prepends), so
            # its z is higher.
            assert result["layerB"] > result["layerA"], result
            # Each label pane rides one z-step above its own layer, so the
            # upper layer's labels cover the lower layer's — the stack order.
            assert result["annB"] == result["layerB"] + 1, result
            assert result["annA"] == result["layerA"] + 1, result
            assert result["annB"] > result["annA"], result
            # Both panes carry the base layer class plus the annotation role.
            for which in ("A", "B"):
                classes = result[f"paneClasses{which}"]
                assert classes is not None, result
                assert classes["layer"] is True, (
                    f"annotation pane must carry foliplus-layer-pane: {result}"
                )
                assert classes["annotation"] is True, (
                    f"annotation pane must carry foliplus-annotation-pane: {result}"
                )
            assert not errors, f"JS errors: {errors}"

    def test_annotation_focus_lifts_label_pane(self, browser, tmp_path):
        """Focusing a layer raises its label pane and draws only its labels."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/annotation_focus_lifts_pane"))
            assert result is not None and result["row"] is True, result
            # Focus lifts the focused layer's label pane to focusedZ + 1
            # (FOCUS.PANE_Z 9000 − FOCUSED_Z_GAP 10 + 1).
            assert result["after"]["annA"] == 8991, result
            # The unfocused layer's pane stays where it was.
            assert result["after"]["annB"] == result["before"]["annB"], result
            # The focus filter plans the spotlighted layer only.
            assert result["opaqueA"] > 0, result
            assert result["opaqueB"] == 0, result
            assert not errors, f"JS errors: {errors}"

    def test_opacity_pane_versus_features(self, browser, tmp_path):
        """One pane write per layer, and never onto a pane that is shared.

        After the ordering pass every overlay layer — a plain folium one
        included — owns a pane and has its content migrated into it, so the
        opacity is a single style write instead of a sweep over the features.
        The neighbor is the control: it is a different layer in a different
        pane and must be untouched.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/opacity_pane_isolation"))
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"

            # Plain layer: its own pane carries the opacity...
            assert result["plainOpened"] is True, result
            assert result["plainPaneShared"] is False, result
            assert result["plainPaneBefore"] in ("", "1"), result
            assert result["plainPaneAfter"] == "0.4", result
            assert result["plainRegistryOpacity"] == 0.4, result
            # ...and the features keep their own style (no per-feature sweep).
            assert result["plainLeafOpacity"], result
            assert all(v == 1 for v in result["plainLeafOpacity"]), result
            # The neighbor is a different layer in a different pane.
            assert result["plainNeighbourSamePane"] is False, result
            assert result["plainNeighbourPaneOpacity"] in ("", "1"), result
            assert result["plainNeighbourLeafOpacity"], result
            assert all(v == 1 for v in result["plainNeighbourLeafOpacity"]), result

            # Managed layer: its declared panes carry it, one write each.
            assert result["managedOpened"] is True, result
            assert result["managedGraphPaneShared"] is False, result
            assert result["managedGraphPaneOpacity"] == "0.4", result
            assert result["managedNodePaneOpacity"] == "0.4", result
            assert result["managedPolylineOpacity"] == 1, result

            # Case C: a hollow polygon (fillOpacity: 0) keeps its hole — the
            # pane's CSS opacity is multiplicative at compositing time, not an
            # override of the feature's own style.  0 × 0.4 = 0.
            assert result["hollowPaneAfter"] == "0.4", result
            assert result["hollowFillOpacity"] == 0, result

            # Case D: annotation labels follow the layer's opacity via bake
            # (R11). The geometry pane carries CSS; the annotation pane is
            # excluded from CSS so it cannot double-compound, and the label
            # canvas carries the baked layerAlpha. A neighbor layer's
            # annotation pane is unaffected (per-layer pane, not shared).
            assert result["annotationPaneExists"] is True, result
            assert result["annotatedGeoPaneOpacity"] == "0", result
            assert result["annotatedAnnotationPaneOpacity"] in ("", "1"), result
            assert result["annotatedLabelBakeAlpha"] == 0, result
            assert result["neighborAnnotationPaneExists"] is True, result
            assert result["neighborAnnotationPaneOpacity"] in ("", "1"), result
            assert not errors, f"JS errors: {errors}"

    def test_unregister_layer_in_browser(self, browser, tmp_path):
        """unregisterLayer removes a dynamically registered layer."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/unregister_layer_flow"))
            assert result is not None
            assert result["before"] is True
            assert result["after"] is False

    def test_sole_basemap_opacity_zero_shows_hatch(self, browser, tmp_path):
        """Dragging the sole basemap's opacity slider to 0 lights the no-basemap hatch.

        The judgement in `syncNoBasemap` (effective visibility = intent
        AND `opacity ?? 1 > 0`) is unit-tested; the trigger is the slider
        drag, which goes through `commitOpacityPct` → `applyProjection`.
        This is the end-to-end bridge — the failure mode is a correct
        judgement that is never called, so the hatch stays off after the
        user has visually emptied every basemap. Overlay opacity must not
        touch the hatch (unrelated to basemap visibility).
        """
        # Default folium map carries one OSM TileLayer; LayerControl picks
        # it up on attach as the sole base row. Hiding that one is enough
        # to leave the map with no visible basemap — which is exactly the
        # T207 scenario.
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        _expand_panel(m)
        # Expose the control instance for the probe (dev build keeps names).
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            m.get_root().render(),
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found"
        html_path = tmp_path / "test_sole_basemap_opacity.html"
        html_path.write_text(html, encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            result = page.evaluate(_js("LayerControl/base_opacity_e2e"))
            assert result is not None
            assert result.get("error") is None, f"setup failed: {result}"

            # Sole base layer, untouched: no hatch.
            assert result["before"]["noBaseMap"] is False, result

            # Drag the sole basemap's opacity to 0: hatch on.
            assert result["atZero"]["noBaseMap"] is True, (
                f"opacity=0 on sole basemap did not light the hatch: {result}"
            )
            assert result["atZero"]["liOpacity"] == 0, result

            # Overlay opacity is unrelated to basemap visibility. Assert the
            # slider actually rendered (a bare featureGroup would not) so the
            # assertion is not vacuous.
            assert result["overlayZero"]["sliderFound"] is True, (
                f"overlay had no opacity slider — vacuous assertion: {result}"
            )
            assert result["overlayZero"]["liOpacity"] == 0, result
            assert result["overlayZero"]["noBaseMap"] is True, (
                f"overlay opacity must not clear the hatch: {result}"
            )

            # Back to 100: hatch off again.
            assert result["atHundred"]["noBaseMap"] is False, (
                f"opacity=1 did not clear the hatch: {result}"
            )
            assert result["atHundred"]["liOpacity"] == 1, result

    def test_create_canvas_basic_api(self, browser, tmp_path):
        """createCanvas returns canvas API object with expected methods."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            api = page.evaluate(_js("LayerControl/create_canvas_api"))
            assert api is not None
            assert api["hasCanvas"]
            assert api["hasCtx"]
            assert api["hasResize"]
            assert api["hasDestroy"]
            assert api["hasUpdatePosition"]
            assert api["hasSetVisible"]
            assert api["hasGetSize"]
            assert api["canvasTag"] == "CANVAS"
            assert api["canvasClass"], "canvas should carry foliplus-canvas-layer"
            assert api["parentIsPane"], "canvas should live in a foliplus-layer-pane"
            assert api["paneRegistered"], "canvas pane should be on the map"

    def test_canvas_register_unregister(self, browser, tmp_path):
        """Canvas register() creates a layer item; unregister() removes it.

        Also asserts the pane model: canvas mounts in its own pane, the ordering
        pass prices the pane from the layer stack, and only destroy() drops the
        pane from the map.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/canvas_register_unregister_dom"))
            assert result is not None
            assert result["hasItem"], "Canvas layer item should exist after register"
            assert not result["hasItemAfter"], (
                "Canvas layer item should be removed after unregister"
            )
            assert result["inPane"], "canvas pane should have foliplus-layer-pane"
            assert result["canvasParent"], "canvas parent should be the dedicated pane"
            assert result["expectedPaneZ"], "canvas should hold a registry slot"
            assert result["paneZ"] == result["expectedPaneZ"], (
                "the ordering pass should price the canvas pane from the layer stack"
            )
            assert result["registeredPaneName"] == "foliplus-canvas-__test_canvas_reg__"
            assert result["paneAfterUnregister"], (
                "unregister keeps the pane for re-register"
            )
            assert not result["paneAfterDestroy"], "destroy drops the pane"

    def test_migrate_layers_marker_pane(self, browser, tmp_path):
        """pinLateContent moves Markers to per-layer panes."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/migrate_marker_pane"))
            assert result is not None
            assert result["pane"] == "__test_marker_pane_graph__"

    def test_migrate_layers_path_pane(self, browser, tmp_path):
        """pinLateContent moves Path layers to the target pane."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/migrate_path_pane"))
            assert result is not None
            assert result["pane"] == "__test_path_pane_graph__"

    def test_load_saved_order_restore_order(self, browser, tmp_path):
        """loadSavedOrder restores previously saved order from localStorage."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="A", overlay=True, show=True),
            folium.FeatureGroup(name="B", overlay=True, show=True),
            folium.FeatureGroup(name="C", overlay=True, show=True),
            slug="saved_order",
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/read_layer_ids"))
            assert result is not None
            assert result["count"] >= 3

    def test_close_btn_aligns_with_header_icon(self, browser, tmp_path):
        """The panel close button sits on the same vertical axis as the header
        icon (the panel's logo).

        Regression for "close button drifts off the header icon's axis": a drift of
        even 1-2 px reads as the × floating off the header's vertical axis. The
        threshold is 2 px so a subpixel rounding from `getBoundingClientRect`
        does not flake the test, but anything above that is a real visual bug.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="A", overlay=True, show=True),
        ) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/read_close_icon_alignment"))
            assert not result.get("error"), f"probe error: {result}"
            assert not errors, f"JS errors: {errors}"
            assert abs(result["deltaPx"]) <= 2, (
                f"close button is {result['deltaPx']:.2f}px off the header "
                f"icon's vertical center -- threshold 2px, got {result}"
            )

    def test_toggle_all_checkbox_toggles_layers(self, browser, tmp_path):
        """Toggle-all checkbox toggles all layers in the group."""
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

            # Deselect the whole overlay group, then wait past the 100ms debounce.
            page.evaluate(_js("LayerControl/click_toggle_all"))
            page.wait_for_timeout(400)
            after_toggle = page.evaluate(_js("LayerControl/toggle_all_reloads_hidden"))
            assert after_toggle["rows"] == [False] * len(before["rows"]), (
                f"toggle-all did not deselect the group: {after_toggle}"
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

    def test_layer_item_title_shows_type(self, browser, tmp_path):
        """Layer item row title shows the translated type, not the layer name."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="MyPoints", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_layer_title.html"
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

            title = page.evaluate(_js("LayerControl/read_layer_item_title"))
            # initTypesAndVisibility runs after 300ms delay; wait if needed
            if not title or "MyPoints" in (title or ""):
                page.wait_for_timeout(500)
                title = page.evaluate(_js("LayerControl/read_layer_item_title"))
            # Should be a type description (e.g. "Point Layer") not the layer name
            assert title and "MyPoints" not in title, (
                f"Expected type title, got '{title}'"
            )

    def test_checkbox_title_shows_select_deselect(self, browser, tmp_path):
        """Checkbox title shows Select/Deselect, not the layer name."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="MyPoints", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_cb_title.html"
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

            title = page.evaluate(_js("LayerControl/read_checkbox_title"))
            assert title and "MyPoints" not in title, (
                f"Expected select/deselect title, got '{title}'"
            )

    def test_rename_keeps_checkbox_title_and_sets_aria_label(self, browser, tmp_path):
        """Renaming a layer updates the label and aria-label, not the tooltip."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="MyPoints", overlay=True, show=True),
            slug="rename_cb_title",
        ) as (page, _):
            page.wait_for_selector(
                ".foliplus-layer-item",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            assert page.evaluate(_js("LayerControl/rename_first_layer")), (
                "failed to open the inline rename input"
            )
            page.wait_for_selector(
                ".foliplus-layer-rename-input", state="attached", timeout=5000
            )
            res = page.evaluate(_js("LayerControl/commit_rename_and_read_checkbox"))
            assert res is not None, "rename did not commit"
            assert res["label"] == "RenamedLayer", f"label={res['label']!r}"
            # The name reaches assistive tech via aria-label…
            assert res["ariaLabel"] == "RenamedLayer", (
                f"aria-label={res['ariaLabel']!r}"
            )
            # …but never replaces the Select/Deselect tooltip (accept the
            # translated wording — a local browser can resolve `zh`).
            assert res["title"] in ("Deselect", "隐藏"), f"title={res['title']!r}"

    def _assert_toggle_all_deselect_title(self, title: str | None, label: str) -> None:
        """The toggle-all tooltip says "deselect all" in whatever locale it renders.

        CI is locale-neutral but a local browser can resolve `zh`, so accept the
        translated wording too — the contract is that the tooltip is the
        toggle-all action, never a layer name.
        """
        assert title and ("Deselect" in title or "隐藏" in title), (
            f"Expected {label} 'deselect all' tooltip, got {title!r}"
        )

    def test_toggle_all_checkbox_title_changes_with_state(self, browser, tmp_path):
        """Toggle-all checkbox title updates when state changes."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_toggle_all_title.html"
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

            # All checked → tooltip is "deselect all"
            self._assert_toggle_all_deselect_title(
                page.evaluate(_js("LayerControl/read_toggle_all_title")), "all-checked"
            )

            # Uncheck one layer → still "deselect all" (indeterminate)
            page.evaluate(_js("LayerControl/click_first_layer_checkbox"))
            page.wait_for_timeout(300)

            self._assert_toggle_all_deselect_title(
                page.evaluate(_js("LayerControl/read_toggle_all_title")),
                "indeterminate",
            )

    def test_toggle_all_row_title_shows_fold_unfold(self, browser, tmp_path):
        """Toggle-all row title shows fold/unfold tooltip."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_row_title.html"
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

            # Expanded → should show "Collapse layers"
            initial = page.evaluate(_js("LayerControl/read_toggle_all_row_title"))
            assert initial and "Collapse" in initial, (
                f"Expected 'Collapse layers', got '{initial}'"
            )

            # Click fold button
            page.evaluate(_js("LayerControl/click_overlay_fold_button"))
            page.wait_for_timeout(300)

            # Folded → should show "Expand layers"
            folded = page.evaluate(_js("LayerControl/read_toggle_all_row_title"))
            assert folded and "Expand" in folded, (
                f"Expected 'Expand layers', got '{folded}'"
            )

    def test_color_layer_item_title(self, browser, tmp_path):
        """Color layer item title shows the color map label."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            title = page.evaluate(_js("LayerControl/read_color_layer_title"))
            assert title, f"Expected non-empty title, got '{title}'"

    def test_register_reentry_after_hide(self, browser, tmp_path):
        """registerLayer can be re-called after a layer is hidden by checkbox."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/register_reentry_after_hide"))
            assert result is not None
            assert result["found"] is True

    def test_register_readds_hidden_layer(self, browser, tmp_path):
        """register() re-adds mainLayer to map when layer was unchecked."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/register_readds_hidden_layer"))
            assert result is not None
            assert result["wasRegistered"] is True, "Layer should be registered"
            assert result["onMapAfterUncheck"] is False, (
                "Layer should be removed from map after uncheck"
            )
            assert result["onMapAfterReadd"] is True, (
                "Layer should be re-added to map after tool re-activation"
            )
            assert result["checkboxChecked"] is True, (
                "Checkbox should be checked after re-activation"
            )

    def test_registry_matches_map_after_reload(self, browser, tmp_path):
        """The registry holds one entry per rendered row, and its ids are stable.

        Confirms the reload page's CONFIG data lands with one id per feature group
        and that the registry view and the map's own layer set agree, before any
        hiding happens. Anything the persistence funnel drops would show here.

        The page declares one overlay with ``show=False``, but that is honored
        by folium's own renderer, not by LayerControl: folium 0.14.0 emits
        ``.addTo(map)`` unconditionally and never removes it, so on that version
        every declared layer starts on the map. What this test pins is therefore
        the registry <-> map agreement itself, not the declared visibility --
        a mismatch shows up the same way either way.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Light Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
        ).add_to(m)
        folium.TileLayer(
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Dark Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
            show=False,
        ).add_to(m)
        folium.FeatureGroup(name="Facility Points", overlay=True, show=False).add_to(m)
        folium.FeatureGroup(name="Commuting Routes", overlay=True, show=True).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_registry_ids.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            info = page.evaluate(_js("LayerControl/read_hidden_state"))
            # Overlays only: the two TileLayers are base rows, which the
            # selector excludes by class. A [data-layer-id] selector would count
            # each layer twice, since renderLayerItem stamps the id on the row
            # and again on its count cell.
            assert len(info["rows"]) == 2, f"expected 2 overlay rows, got {info}"
            ids = [r["id"] for r in info["rows"]]
            # Distinct ids: a duplicate would make the persisted hidden set apply
            # to only one of the two.
            assert len(set(ids)) == len(ids), f"duplicate layer ids in registry: {ids}"
            # The fixture throws if a rendered row has no registry entry, since
            # such a row's state has no source of truth. A null here means the
            # manager's own resolver could not find the Leaflet layer -- that
            # row cannot be added or removed, so no state on it can be honored
            # after a reload.
            unresolved = [r for r in info["rows"] if r["onMap"] is None]
            assert not unresolved, f"unresolved layers in registry: {unresolved}"
            # The registry's own flag and the Leaflet attachment agree per row.
            # Declared show=False is deliberately not asserted here: folium 0.14
            # adds every layer regardless, so the declared visibility differs
            # across folium versions while the registry/map agreement never does.
            for r in info["rows"]:
                assert r["checked"] == r["visible"] == r["onMap"], (
                    f"{r['id']}: checkbox, registry and map disagree: {info}"
                )

    def test_hidden_layers_survive_reload(self, browser, tmp_path):
        """A layer hidden by checkbox stays hidden across a reload.

        Regression guard for the persistence funnel: the write is debounced at
        100ms, so a reload inside that window previously landed on stale
        storage. Hiding happens here, the reload there -- the two pages are
        distinct so nothing survives except localStorage.

        Base layers plus a hidden-from-the-start overlay mirror a real folium
        page, where ``TileLayer(show=False)`` and the map's own theme layers
        share the panel with the data overlays.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Light Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
        ).add_to(m)
        folium.TileLayer(
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Dark Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
            show=False,
        ).add_to(m)
        folium.FeatureGroup(name="Facility Points", overlay=True, show=False).add_to(m)
        folium.FeatureGroup(name="Commuting Routes", overlay=True, show=True).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_hidden_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            hide = page.evaluate(_js("LayerControl/hide_then_reload"))
            assert hide is not None and hide["rows"] == 2, f"unexpected rows: {hide}"
            assert hide["stillChecked"] == 0, "both overlays should be unchecked"

            # Let the debounce commit, then reload -- a reload inside the
            # window is what used to drop the write.
            page.wait_for_timeout(300)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # Re-checked rows, rows whose registry entry still claims visible,
            # and layers that are still attached to the map -- each half of the
            # projection, so the assertion cannot be satisfied by faking one.
            rows = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert rows and len(rows["rows"]) == 2, f"expected 2 rows, got {rows}"
            for row in rows["rows"]:
                assert row["checked"] is False, (
                    f"{row['id']}: row was re-checked after reload\n{rows}"
                )
                assert row["visible"] is False, (
                    f"{row['id']}: registry says visible but the user hid it\n{rows}"
                )
                assert row["onMap"] is False, (
                    f"{row['id']}: still attached to the map after reload\n{rows}"
                )

    def test_showing_author_hidden_layers_survives_reload(self, browser, tmp_path):
        """A layer the author declared ``show=False`` and the user checked ON
        comes back ON after a reload.

        This is the reported regression: the old hidden-mirror model recorded
        ``hiddenLayerIds`` as *which layers the user hid* rather than *which layers
        are hidden*, so an id that
        folium had rendered off-map was never in the set. Checking it on
        therefore removed nothing from nothing, storage stayed ``[]``, and the
        reload restored the author's defaults.

        It is also the inverse of test_hidden_layers_survive_reload: that one
        proves the hide half of the round trip, this one proves the unhide
        half. A sweep that only walks the hidden-intent values can never reach a
        layer the
        user left visible.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Light Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
        ).add_to(m)
        folium.TileLayer(
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Dark Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
            show=False,
        ).add_to(m)
        folium.FeatureGroup(name="Facility Points", overlay=True, show=False).add_to(m)
        folium.FeatureGroup(name="Commuting Routes", overlay=True, show=True).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_show_hidden_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # Observe the pre-state rather than assuming folium rendered the
            # declared show=False: folium 0.14.0 adds every layer and never
            # removes it, so the rows that start off-map differ across versions.
            # The point is the round trip -- whatever starts hidden must come
            # back checked -- not which folium produced the hidden set.
            before = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert before and len(before["rows"]) == 2, f"unexpected rows: {before}"
            for row in before["rows"]:
                assert row["checked"] == row["visible"] == row["onMap"], (
                    f"{row['id']}: checkbox, registry and map disagree at load\n{before}"
                )

            show = page.evaluate(_js("LayerControl/show_author_hidden"))
            assert show is not None and show["rows"] == 2, f"unexpected rows: {show}"
            hidden_before = sum(1 for r in before["rows"] if not r["checked"])
            assert show["checked"] == hidden_before, (
                f"expected the {hidden_before} off-map layer(s) to be shown\n{show}"
            )
            assert show["stillUnchecked"] == 0, f"rows left unchecked\n{show}"

            page.wait_for_timeout(300)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # Each half of the projection is asserted separately, mirroring
            # test_hidden_layers_survive_reload: a UI-only fix (rows re-checked)
            # or a data-only fix (registry says visible) would not put the layer
            # back on the map.
            rows = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert rows and len(rows["rows"]) == 2, f"expected 2 rows, got {rows}"
            for row in rows["rows"]:
                assert row["checked"] is True, (
                    f"{row['id']}: row lost its check after reload\n{rows}"
                )
                assert row["visible"] is True, (
                    f"{row['id']}: registry reverted to the author default\n{rows}"
                )
                assert row["onMap"] is True, (
                    f"{row['id']}: never re-added to the map after reload\n{rows}"
                )

    def test_author_defaults_survive_a_reload_with_no_toggle(self, browser, tmp_path):
        """Author ``show=False`` layers stay hidden when the user never touched
        the panel, and reload repeatedly.

        Guards the other half of the same change: with no visibility key in
        storage the user has made no choice, so the unhide sweep must not
        override the author's defaults. Without that guard the first reload of
        a map like the quickstart re-added every hidden overlay.

        "Author defaults" here means whatever folium rendered at load, which is
        read rather than assumed: folium 0.14.0 adds every layer regardless of
        show=False, so the default is visible on that version. The user never
        touched the panel, so storage stays empty and the invariant is that a
        reload leaves the load state untouched -- whatever it was.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Light Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
        ).add_to(m)
        folium.TileLayer(
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Dark Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
            show=False,
        ).add_to(m)
        folium.FeatureGroup(name="Facility Points", overlay=True, show=False).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_author_defaults_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # No interaction at all -- the panel merely opened on load.
            initial = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert initial and len(initial["rows"]) == 1, (
                f"expected 1 row, got {initial}"
            )
            load_checked = initial["rows"][0]["checked"]
            load_storage = dict(initial["storage"])

            for _ in range(2):
                page.reload(wait_until="domcontentloaded")
                page.wait_for_selector(
                    ".foliplus-layer-ctrl", state="attached", timeout=10000
                )
                page.wait_for_selector(
                    ".foliplus-layer-ctrl.foliplus-is-expanded",
                    state="attached",
                    timeout=10000,
                )
                page.wait_for_timeout(500)

                rows = page.evaluate(_js("LayerControl/read_hidden_state"))
                assert len(rows["rows"]) == 1, f"expected 1 row, got {rows}"
                row = rows["rows"][0]
                # The load state is untouched, and the three projections of it
                # still agree -- so a reload neither re-added a hidden layer
                # nor dropped one the author left on.
                assert row["checked"] is load_checked, (
                    f"reload with no user choice changed the load state\n{rows}"
                )
                assert row["checked"] == row["visible"] == row["onMap"], (
                    f"{row['id']}: checkbox, registry and map disagree\n{rows}"
                )
                # Nothing may be persisted when the user never toggled: the
                # unhide sweep must not synthesise a choice and write it down,
                # and a runtime-created row (the color basemap) must not
                # rewrite the order the user arranged.
                assert rows["storage"] == load_storage, (
                    f"reload with no user choice wrote a stored record\n{rows}"
                )

    def test_hidden_layers_persist_across_reload(self, browser, tmp_path):
        """A hidden layer that re-registers later comes back hidden, not reset.

        HeatmapControl and MeasureControl register in their own constructor,
        which runs after the LayerControl IIFE has attached, so a hidden id can
        precede its row. The reload must leave the stored record alone -- a
        missing registry entry is not evidence that the state should go, only
        a delete is -- so when the component re-registers the layer returns the
        way the user left it instead of resurrecting visible.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Seed", overlay=True, show=True).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_hidden_reload_dynamic.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # Register through LayerAPI, as a component's constructor would.
            page.evaluate(_js("LayerControl/register_hidden_probes"))
            page.wait_for_timeout(100)

            hide = page.evaluate(_js("LayerControl/hide_then_reload"))
            assert hide is not None and hide["rows"] == 3, f"unexpected rows: {hide}"
            assert hide["stillChecked"] == 0, "all overlays should be unchecked"
            assert len(set(hide["ids"])) == 3, f"duplicate row ids: {hide}"

            page.wait_for_timeout(300)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # The probes were only registered at runtime, so they are gone
            # until re-registered -- and their ids survive the reload in
            # storage: nothing pruned them merely because their registry
            # entries did not.
            rows = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert len(rows["rows"]) == 1, f"expected 1 row, got {rows}"
            assert rows["rows"][0]["checked"] is False
            assert rows["rows"][0]["visible"] is False
            assert rows["rows"][0]["onMap"] is False
            key = next(k for k in rows["storage"] if "layer_state" in k)
            layers = json.loads(rows["storage"][key]).get("layers", {})
            assert {lid for lid in layers if lid.startswith("__probe")} == {
                "__probeA__",
                "__probeB__",
            }, f"reload pruned ids it had no right to drop: {rows['storage']}"
            for lid in ("__probeA__", "__probeB__"):
                assert layers[lid]["visible"] is False, (
                    f"{lid}: reload changed a stored hidden state: {rows['storage']}"
                )

            page.evaluate(_js("LayerControl/register_hidden_probes"))
            page.wait_for_timeout(300)

            # Re-registration restores the stored state instead of resetting
            # it: the probes come back off the map, unchecked, and the three
            # projections of their state still agree.
            rows = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert len(rows["rows"]) == 3, f"expected 3 rows, got {rows}"
            for row in rows["rows"]:
                if row["id"].startswith("__probe"):
                    assert row["checked"] is False, (
                        f"{row['id']}: re-register reset a stored hidden state\n{rows}"
                    )
                    assert row["visible"] is False, (
                        f"{row['id']}: registry lost a stored hidden state\n{rows}"
                    )
                    assert row["onMap"] is False, (
                        f"{row['id']}: re-entered the map while hidden\n{rows}"
                    )

    def test_late_layer_opacity_survives_reload(self, browser, tmp_path):
        """A lazily-registered layer keeps its stored opacity across a reload.

        HeatmapControl registers its canvas in its own constructor, which runs
        after the LayerControl IIFE has already attached the panel. On the
        first attach the heatmap's id is therefore unresolvable, and the sweep
        used to read that as "the layer is gone for good": it dropped the
        stored opacity from memory and wrote the deletion back, so every
        refresh reset the user's opacity to the author default. Nothing in the
        page says the layer is gone -- only a delete does -- so a reload must
        not touch the record at all.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        fg = folium.FeatureGroup(name="Points", show=True)
        folium.GeoJson(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {"val": 26.08},
                            "geometry": {
                                "type": "Point",
                                "coordinates": [119.30, 26.08],
                            },
                        }
                    ],
                }
            )
        ).add_to(fg)
        fg.add_to(m)
        LayerControl().add_to(m)
        HeatmapControl().add_to(m)
        _expand_panel(m)

        html = m.get_root().render()
        match = re.search(r"var (map_[0-9a-f]+) = L\.map", html)
        assert match, "map variable not found in rendered HTML"
        # The visit under test is the reload: seed the record the previous
        # visit would have written (heatmap at 35%), then re-read it. The
        # heatmap id is the stable component id, not a per-map suffix.
        seed = {
            "order": None,
            "foldedGroups": [],
            "renamedNames": {},
            "annotations": {},
            "layers": {
                "foliplus_heatmap": {
                    "opacity": 0.35,
                    "overrides": ["opacity"],
                }
            },
        }

        html_path = tmp_path / "test_late_layer_opacity_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.add_init_script(
                _js("LayerControl/seed_layer_state")
                .replace("__KEY__", match.group(1))
                .replace("__SEED__", json.dumps(json.dumps(seed)))
            )
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            heatmap_ready(page, timeout=15000)
            page.wait_for_timeout(200)

            # The value the previous visit wrote must still be in storage.
            after_attach = page.evaluate(_js("LayerControl/read_opacity_state"))
            assert after_attach.get("id"), f"heatmap row missing: {after_attach}"
            assert after_attach["stored"] == 0.35, (
                f"attach dropped the stored opacity: {after_attach}"
            )
            assert after_attach["overrides"] == ["opacity"], (
                f"attach dropped the stored provenance: {after_attach}"
            )
            assert after_attach["canvasRegistered"] is True, (
                f"heatmap canvas never registered: {after_attach}"
            )
            assert after_attach["canvasOpacity"] == "0.35", (
                f"attach reset the canvas to the author default: {after_attach}"
            )

            # And the user can still move the slider, then survive a reload.
            set_result = page.evaluate(_js("LayerControl/set_heatmap_opacity"))
            assert set_result.get("id"), f"could not set opacity: {set_result}"
            assert set_result["value"] == 35, f"slider did not take 35: {set_result}"
            page.wait_for_timeout(300)

            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            heatmap_ready(page, timeout=15000)
            page.wait_for_timeout(200)

            after_reload = page.evaluate(_js("LayerControl/read_opacity_state"))
            assert after_reload.get("id"), f"heatmap row missing: {after_reload}"
            assert after_reload["stored"] == 0.35, (
                f"reload reverted the user's opacity to the author default: "
                f"{after_reload}"
            )
            assert after_reload["overrides"] == ["opacity"], (
                f"reload dropped the stored provenance: {after_reload}"
            )
            assert after_reload["canvasOpacity"] == "0.35", (
                f"reload painted the canvas at the author default: {after_reload}"
            )

    def test_third_party_component_rename_survives_reload(self, browser, tmp_path):
        """A rename on a late-registering component (HeatmapControl) survives reload.

        Third-party components (HeatmapControl, MeasureControl) call
        ``registerLayer`` in their own constructors, which run after LayerControl
        has attached its panel. On the first attach the sweep runs before the
        component registers; on a later attach the component registers while
        ``applyUserState`` is replaying stored state. Without id-scoped replay the
        component's own ``name`` clobbers the user's rename on the reload -- the
        exact symptom of "renaming a third-party component does not stick
        across reload".

        This test seeds a HeatmapControl row with a user rename, reloads, and
        asserts the renamed label is the one the row paints (not the author
        default).
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        fg = folium.FeatureGroup(name="Points", show=True)
        folium.GeoJson(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {"val": 26.08},
                            "geometry": {
                                "type": "Point",
                                "coordinates": [119.30, 26.08],
                            },
                        }
                    ],
                }
            )
        ).add_to(fg)
        fg.add_to(m)
        LayerControl().add_to(m)
        HeatmapControl().add_to(m)
        _expand_panel(m)

        html = m.get_root().render()
        match = re.search(r"var (map_[0-9a-f]+) = L\.map", html)
        assert match, "map variable not found in rendered HTML"

        # The persisted record the previous visit would have written: the heatmap
        # row is renamed to "My Heat" by the user. Id is the stable component id,
        # not a per-map suffix.
        seed = {
            "order": None,
            "foldedGroups": [],
            "renamedNames": {"foliplus_heatmap": "My Heat"},
            "annotations": {},
            "layers": {},
        }
        html_path = tmp_path / "test_third_party_rename_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.add_init_script(
                _js("LayerControl/seed_layer_state")
                .replace("__KEY__", match.group(1))
                .replace("__SEED__", json.dumps(json.dumps(seed)))
            )
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            heatmap_ready(page, timeout=15000)
            page.wait_for_timeout(300)

            after_attach = page.evaluate(_js("LayerControl/read_rename_state"))
            assert after_attach["rowPresent"] is True, (
                f"heatmap row missing after attach: {after_attach}"
            )
            assert after_attach["storedRename"] == "My Heat", (
                f"attach dropped the stored rename: {after_attach}"
            )
            assert after_attach["label"] == "My Heat", (
                f"attach painted the author default instead of the rename: "
                f"{after_attach}"
            )

            # A second reload must land the same way: a late-registered component
            # that runs its own `registerLayer` on the second attach used to
            # clobber the rename at the point where the sweep replayed it.
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            heatmap_ready(page, timeout=15000)
            page.wait_for_timeout(300)

            after_reload = page.evaluate(_js("LayerControl/read_rename_state"))
            assert after_reload["rowPresent"] is True, (
                f"heatmap row missing after reload: {after_reload}"
            )
            assert after_reload["storedRename"] == "My Heat", (
                f"reload dropped the stored rename: {after_reload}"
            )
            assert after_reload["label"] == "My Heat", (
                f"reload reverted the third-party component's rename to the "
                f"author default: {after_reload}"
            )

    def test_vector_border_writes_the_stroke_and_survives_reload(
        self, browser, tmp_path
    ):
        """A border change rewrites the vector's own stroke and outlives reload.

        Border is not part of the executor's visible / opacity / zoomRange
        family — the panel writes it with a direct ``setStyle`` — so nothing in
        the projection replay would restore it. Without its own replay the row
        could show the user's color while the map kept painting the author's
        stroke, which is the one failure mode this asserts against.
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        # The polygon rides inside a named, visible FeatureGroup: that is how a
        # data layer earns a panel row (a bare vector has no control of its own).
        fg = folium.FeatureGroup(name="Test Region", overlay=True, show=True)
        folium.Polygon(
            [[30.0, 120.0], [31.0, 121.0], [30.5, 121.5]],
            color="#0000ff",
            weight=2,
        ).add_to(fg)
        fg.add_to(m)
        LayerControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_vector_border_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            before = page.evaluate(
                _js("LayerControl/border_set_and_read"), ["Test Region"]
            )
            assert before.get("row"), f"layer row not found: {before}"
            assert before["strokes"], f"no stroked path on the map: {before}"
            for stroke in before["strokes"]:
                assert stroke["stroke"] == "#0000ff", (
                    f"author stroke never reached the map: {before}"
                )
                assert stroke["strokeWidth"] == "2", (
                    f"author width never reached the map: {before}"
                )

            row = page.evaluate(
                _js("LayerControl/border_set_and_read"),
                ["Test Region", "#ff0000", 6],
            )
            assert row.get("panel"), f"the style panel did not open: {row}"
            assert row["borderRows"] == 1, f"expected one border row: {row}"
            assert row["color"] == "#ff0000", f"swatch did not take: {row}"
            assert row["weight"] == "6", f"width field did not take: {row}"
            assert row["strokes"], f"the stroke never reached the map: {row}"
            for stroke in row["strokes"]:
                assert stroke["stroke"] == "#ff0000", (
                    f"the color change did not reach the SVG: {row}"
                )
                assert stroke["strokeWidth"] == "6", (
                    f"the width change did not reach the SVG: {row}"
                )

            # Let the debounce commit, then reload — the stored record is the
            # only thing that survives.
            page.wait_for_timeout(300)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            after = page.evaluate(
                _js("LayerControl/border_set_and_read"), ["Test Region"]
            )
            assert after.get("panel"), f"the style panel did not reopen: {after}"
            assert after["color"] == "#ff0000", (
                f"reload reverted the border color: {after}"
            )
            assert after["weight"] == "6", f"reload reverted the border width: {after}"
            assert after["strokes"], f"no stroked path after reload: {after}"
            for stroke in after["strokes"]:
                assert stroke["stroke"] == "#ff0000", (
                    f"reload dropped the border stroke\n{after}"
                )
                assert stroke["strokeWidth"] == "6", (
                    f"reload dropped the border width\n{after}"
                )

            key = next(k for k in after["storage"] if "layer_state" in k)
            record = json.loads(after["storage"][key])
            # The record is keyed by folium's generated id, not the label the
            # row displays.
            entry = record["layers"].get(after["id"])
            assert entry, f"border state never persisted: {record}"
            assert entry["borderColor"] == "#ff0000", f"stored the wrong color: {entry}"
            assert entry["borderWeight"] == 6, f"stored the wrong width: {entry}"

    def test_heatmap_keeps_its_own_border_row_only(self, browser, tmp_path):
        """The delegated drawer owns the heatmap's border, so one row total.

        The generic border row must never render next to the drawer's own
        border row in the same panel — the two write through different paths
        and would fight over the same visual axis.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        # The heatmap only earns a panel row once it has a point layer to
        # aggregate, so give it one — its id is the stable component id.
        fg = folium.FeatureGroup(name="Points", show=True)
        folium.GeoJson(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {"val": 26.08},
                            "geometry": {
                                "type": "Point",
                                "coordinates": [119.30, 26.08],
                            },
                        }
                    ],
                }
            )
        ).add_to(fg)
        fg.add_to(m)
        LayerControl().add_to(m)
        HeatmapControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_border_heatmap.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            heatmap_ready(page, timeout=15000)
            panel_ready(page)
            page.wait_for_timeout(200)

            panel = page.evaluate(
                _js("LayerControl/border_set_and_read"), ["foliplus_heatmap"]
            )
            assert panel.get("panel"), f"the heatmap panel did not open: {panel}"
            # The drawer builds its own border row with the shared FORM_ROW
            # chrome but not the vector row's class.
            assert panel["borderRows"] == 0, (
                f"the vector border row rendered for a delegated layer: {panel}"
            )
            assert panel["labels"].count("Border") == 1, (
                f"expected exactly one border row, got: {panel['labels']}"
            )

    def test_border_swatch_shows_a_named_color_as_hex(self, browser, tmp_path):
        """The swatch agrees with the map for a named authored color.

        folium's quickstart styles its faces with the named color ``gray``.
        The GeoJSON read used to return the layer's own options instead of
        its first feature's, which put a stroke the map was not painting into
        the panel — the same "the swatch disagrees with the map" defect,
        reached through the color form instead of through the layer tree.

        The face paints ``stroke="gray"``; the swatch must therefore read
        ``#808080``, the hex for that same color, not black and not
        Leaflet's default. The neighboring line keeps its own stroke, which
        pins the assertion to the color form rather than to anything the
        map does with it.
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        fg = folium.FeatureGroup(name="Region", overlay=True, show=True)
        folium.GeoJson(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {"kind": "face"},
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [
                                    [
                                        [120.0, 30.0],
                                        [121.0, 30.0],
                                        [121.0, 31.0],
                                        [120.0, 30.0],
                                    ]
                                ],
                            },
                        },
                        {
                            "type": "Feature",
                            "properties": {"kind": "line"},
                            "geometry": {
                                "type": "LineString",
                                "coordinates": [[120.2, 30.2], [120.8, 30.8]],
                            },
                        },
                    ],
                }
            ),
            style_function=lambda f: (
                {"color": "gray", "weight": 1.5}
                if f["properties"]["kind"] == "face"
                else {"color": "#e74c3c", "weight": 6}
            ),
        ).add_to(fg)
        fg.add_to(m)
        LayerControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_border_named_color.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            row = page.evaluate(_js("LayerControl/border_set_and_read"), ["Region"])
            assert row.get("panel"), f"the style panel did not open: {row}"
            assert row["borderRows"] == 1, f"expected one border row: {row}"
            # gray as hex — not black, and not Leaflet's default.
            assert row["color"] == "#808080", (
                f"the swatch did not show the authored name as hex: {row}"
            )
            assert row["weight"] == "1.5", f"the width field did not take: {row}"

            strokes = {s["stroke"] for s in row["strokes"]}
            assert "gray" in strokes, (
                f"the face stopped painting the authored name\n{row['strokes']}"
            )
            assert "#e74c3c" in strokes, (
                f"the neighbouring line lost its own stroke\n{row['strokes']}"
            )

    def test_circlemarker_stroke_false_border_write_is_visible_and_resettable(
        self, browser, tmp_path
    ):
        """A stroke:false CircleMarker must show a user border, and Reset must hide it again.

        quickstart Facility Points authors ``style_kwds={"stroke": False}``
        (geopandas explore → folium CircleMarker). Writing color/weight alone
        leaves Path painting ``stroke=none`` — the panel change would be a
        silent no-op. The write must turn stroke on; Reset must put the
        author's ``stroke: False`` back so the border disappears again.
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        fg = folium.FeatureGroup(name="Facility Points", overlay=True, show=True)
        folium.CircleMarker(
            [30.0, 120.0],
            radius=5,
            color="#3388ff",
            weight=2,
            fill=True,
            fill_opacity=0.8,
            stroke=False,
        ).add_to(fg)
        fg.add_to(m)
        LayerControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_circlemarker_stroke_false_border.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            before = page.evaluate(
                _js("LayerControl/border_set_and_read"), ["Facility Points"]
            )
            assert before.get("panel"), f"the style panel did not open: {before}"
            assert before["borderRows"] == 1, f"expected one border row: {before}"
            for stroke in before["strokes"]:
                assert stroke["stroke"] in (None, "none"), (
                    f"author stroke:false should paint stroke=none: {before}"
                )

            row = page.evaluate(
                _js("LayerControl/border_set_and_read"),
                ["Facility Points", "#ff0000", 6],
            )
            assert row.get("panel"), f"the style panel did not open: {row}"
            assert row["strokes"], f"no path on the map: {row}"
            for stroke in row["strokes"]:
                assert stroke["stroke"] == "#ff0000", (
                    f"border color did not reach the SVG: {row}"
                )
                assert stroke["strokeWidth"] == "6", (
                    f"border width did not reach the SVG: {row}"
                )

            reset = page.evaluate(
                _js("LayerControl/border_set_and_read"),
                ["Facility Points", None, None, True],
            )
            assert reset.get("panel"), f"the style panel did not reopen: {reset}"
            assert reset["strokes"], f"no path after reset: {reset}"
            for stroke in reset["strokes"]:
                assert stroke["stroke"] in (None, "none"), (
                    f"reset must restore the author's stroke:false\n{reset}"
                )

    def test_unregister_keeps_stored_opacity_delete_drops_it(self, browser, tmp_path):
        """unregisterLayer never erases a value; only an explicit delete does.

        The heatmap's empty-data frame reaches unregisterLayer the same way
        this probe does, so the teardown that drops a stored opacity would
        have fired on a data change -- the user would see "I only switched the
        data source, why did my opacity reset?" Deleting the layer is the one
        action that knows the id is gone for good.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_unregister_keeps_opacity.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(200)

            result = page.evaluate(_js("LayerControl/canvas_unregister_keeps_state"))
            assert result.get("afterSet"), f"probe did not reach the write: {result}"
            assert result["afterSet"] == {
                "opacity": 0.35,
                "overrides": ["opacity"],
            }, f"slider write did not persist: {result}"

            # The layer is gone from the map and the panel...
            assert result["registeredAfterUnregister"] is False, (
                f"unregister did not remove the layer: {result}"
            )
            # ...but the stored opacity is untouched, and the registry did not
            # keep a row for it either.
            assert result["afterUnregister"] == {
                "opacity": 0.35,
                "overrides": ["opacity"],
            }, f"unregister erased a value it had no right to drop: {result}"

            # The explicit path is what drops it -- and only it.
            assert result["deleteError"] is None, (
                f"deleteLayer raised: {result['deleteError']}"
            )
            assert result["deleteReturn"] is True, f"deleteLayer failed: {result}"
            assert result["afterDelete"] is None, (
                f"delete did not drop the stored value: {result}"
            )
            assert result["registeredAfterDelete"] is False, (
                f"delete left the layer registered: {result}"
            )

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

    def test_bring_layer_to_front_runtime(self, browser, tmp_path):
        """bringLayerToFront moves the layer to front of z-order."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="A", overlay=True, show=True),
            folium.FeatureGroup(name="B", overlay=True, show=True),
            slug="bring_front",
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/bring_layer_to_front"))
            assert result is not None, "LayerAPI not found"
            assert result["newIdx"] == 0, (
                f"Expected layer B at index 0 after bringToFront, got {result['newIdx']} (was {result['initialIdx']})"
            )

    def test_unregister_layer_removes_dom(self, browser, tmp_path):
        """unregisterLayer removes the DOM item from the panel."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/unregister_layer_removes_dom"))
            assert result is not None
            assert result["existsBefore"] is True, (
                "DOM item should exist after registerLayer"
            )
            assert result["existsAfter"] is False, (
                "DOM item should be removed after unregisterLayer"
            )

    def test_color_layer_coexists_with_tiles(self, browser, tmp_path):
        """Color and tile basemaps coexist. Checking the color basemap's
        checkbox activates its own pane (the retired
        `foliplus-layer-tile-hidden` contract is gone — tiles stay in the DOM
        and remain fetchable)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False).add_to(
            m
        )

        html_path = tmp_path / "test_color_tiles.html"
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

            # Check the color basemap's checkbox — the only legitimate path
            # to show the color layer. Clicking the row body no longer does
            # it (#494).
            toggle = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert toggle is not None and toggle["ok"] is True, toggle
            page.wait_for_timeout(500)

            result = page.evaluate(_js("LayerControl/read_color_tile_state"))
            assert result is not None
            # The retired tile-hidden contract must not be applied.
            assert result["tileHidden"] is False, (
                "colour layer must not stamp foliplus-layer-tile-hidden"
            )
            assert result["colorBg"] is True, "color item should have active class"

    def test_color_basemap_checkbox_toggles_visibility(self, browser, tmp_path):
        """Checking the color basemap's checkbox must toggle its visibility.

        The row's checkbox column holds a real ``<input type="checkbox">``
        (like every other basemap row).  Checking it paints the container
        background (``.foliplus-active`` + ``--color-layer-bg``); unchecking it clears
        both.  Without the fix the row has only a color picker and no
        checkbox, so the toggle cannot happen.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        html_path = tmp_path / "test_color_checkbox.html"
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

            # Initial state: checkbox exists and is unchecked.
            state = page.evaluate(_js("LayerControl/read_color_checkbox_state"))
            assert state is not None
            assert state["hasCheckbox"] is True, (
                "colour basemap row must have a real checkbox"
            )
            assert state["checked"] is False, "colour basemap starts unchecked"
            assert state["active"] is False, "container starts without .foliplus-active"

            # Check the checkbox → container background takes effect.
            result = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert result is not None and result["ok"] is True, result
            assert result["checked"] is True

            state = page.evaluate(_js("LayerControl/read_color_checkbox_state"))
            assert state["checked"] is True
            assert state["active"] is True, "checking must mark the color row active"
            assert state["colorVisible"] is True, (
                "checking must show the color pane face"
            )

            # Uncheck → container background cleared.
            result = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert result is not None and result["ok"] is True, result
            assert result["checked"] is False

            state = page.evaluate(_js("LayerControl/read_color_checkbox_state"))
            assert state["checked"] is False
            assert state["active"] is False, (
                "unchecking must clear the color row active class"
            )
            assert state["colorVisible"] is False, (
                "unchecking must hide the color pane face"
            )

    def test_color_basemap_zorder_stack(self, browser, tmp_path):
        """Color basemap participates in the z-order ladder like tile basemaps.

        Row order = visual stack order. When the color row is above a tile
        basemap, its pane has a higher z-index and covers the tiles; when
        below, the tiles cover it. Reordering flips the stack live.
        """
        tile = folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False)
        with use_page(self._make_page, browser, tmp_path, tile) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            # Read initial state.
            state0 = page.evaluate(_js("LayerControl/read_color_checkbox_state"))
            assert state0 is not None

            # Ensure the color basemap is shown (check the checkbox if unchecked).
            if not state0.get("checked"):
                result = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
                assert result["ok"] is True
            else:
                # Already checked — verify the pane exists.
                result = {"ok": True, "checked": True}

            # Initial state: color pane exists and tile pane exists.
            state = page.evaluate(_js("LayerControl/color_zorder_stack"))
            assert state["ok"] is True
            assert state["colorPaneFound"] is True, "color pane must exist after show"
            assert state["tilePaneFound"] is True
            assert state["colorPaneZ"] is not None
            assert state["tilePaneZ"] is not None
            initialColorZ = state["colorPaneZ"]

            # Case 1: move color above tile → color pane z increases.
            page.evaluate(_js("LayerControl/set_probe"), {"action": "above"})
            state = page.evaluate(_js("LayerControl/color_zorder_stack"))
            assert state["ok"] is True
            assert state["colorPaneZ"] > initialColorZ, (
                f"color above: z should increase, {initialColorZ} -> {state['colorPaneZ']}"
            )

            # Case 2: move color below tile → color pane z drops below the tile pane.
            page.evaluate(_js("LayerControl/set_probe"), {"action": "below"})
            state = page.evaluate(_js("LayerControl/color_zorder_stack"))
            assert state["ok"] is True
            assert state["colorPaneZ"] < state["tilePaneZ"], (
                f"color below: color pane z must be below tile pane z, "
                f"color={state['colorPaneZ']} tile={state['tilePaneZ']}"
            )
            assert state["colorPaneZ"] == initialColorZ, (
                f"color below: z should return to initial, "
                f"{initialColorZ} -> {state['colorPaneZ']}"
            )

            # Case 3: reorder back above → z-indexes flip again (live).
            page.evaluate(_js("LayerControl/set_probe"), {"action": "above"})
            state = page.evaluate(_js("LayerControl/color_zorder_stack"))
            assert state["ok"] is True
            assert state["colorPaneZ"] > state["tilePaneZ"], (
                "reorder back above: color z must increase again"
            )

    def test_base_basemap_reorder_repaints_z(self, browser, tmp_path):
        """Every base basemap repaints when its row moves.

        The z ladder is written onto each base layer's own pane
        (synthesized for tile layers, dedicated for the color basemap).
        Reordering two tile basemaps must flip their pane z-indexes AND the
        tiles must actually live in those panes — if they were still in the
        shared .leaflet-tile-pane (z fixed at 200 by Leaflet CSS), the swap
        would change numbers nothing draws on top of.
        """
        tile_a = folium.TileLayer("CartoDB positron", name="Tiles A", overlay=False)
        tile_b = folium.TileLayer("OpenStreetMap", name="Tiles B", overlay=False)
        with use_page(self._make_page, browser, tmp_path, tile_a, tile_b) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(600)

            state = page.evaluate(_js("LayerControl/base_zorder_reorder"))
            assert state["ok"] is True, state
            assert len(state["bases"]) >= 2, f"need two base layers, got {state}"

            # Tiles must paint inside each base layer's own pane, not the
            # shared tilePane — otherwise reorder cannot change the stack.
            assert state["sharedTilePaneImages"] == 0, (
                f"tiles still in shared tilePane: {state}"
            )
            for b in state["bases"]:
                if b["id"] == "foliplus_color_map":
                    continue
                assert b["paintsHere"] > 0, (
                    f"tile layer {b['name']} paints nothing in its own pane: {state}"
                )
                assert b["z"] is not None, (
                    f"tile layer {b['name']} has no ladder z: {state}"
                )

            # Swap the last tile above the first; the two tile panes' z must
            # flip with the row order.
            page.evaluate(_js("LayerControl/set_probe"), {"action": "swap-tiles"})
            state2 = page.evaluate(_js("LayerControl/base_zorder_reorder"))
            assert state2["ok"] is True, state2
            zs2 = {b["id"]: b["z"] for b in state2["bases"]}
            moved = [b for b in state2["bases"] if b["id"] != "foliplus_color_map"]
            first_z2 = moved[0]["z"]
            last_z2 = moved[-1]["z"]
            # The tile that moved to the top must now sit above the other.
            assert first_z2 > last_z2, f"reordered tile panes did not flip z: {moved}"

    def test_register_layer_preserves_visible_on_reentry(self, browser, tmp_path):
        """registerLayer preserves the visible state from a previous registration.

        Intent is the single source of truth (#498): a hide recorded through
        setVisible survives unregisterLayer — which is a teardown, not a
        delete — and is replayed on the next registerLayer of the same id.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/register_preserves_visible_on_reentry")
            )
            assert result is not None
            assert result["defaultVisible"] is True, "Default visible should be true"
            assert result["newVisible"] is False, (
                "the hide recorded by setVisible must survive unregister/re-register; "
                f"got {result}"
            )

    def test_register_re_register_preserves_fields(self, browser, tmp_path):
        """A partial re-register never drops previously registered fields.

        createLayerInfo is idempotent: fields absent from the second opts
        (layer/paneName/iconSvg/name/group) fall back to
        the existing layerInfo instead of being reset to defaults.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            # The icon the fixture registers. Degenerate markup is rejected
            # by the sanitizer, so it must be real SVG.
            svg = '<svg viewBox="0 0 4 4"><rect width="2" height="2"/></svg>'
            result = page.evaluate(_js("LayerControl/re_register_preserves_fields"))
            assert result is not None and "error" not in result, result
            for phase in ("before", "after"):
                r = result[phase]
                # `name` never leaves the registry's own values: the initial
                # registration falls back to the id, and the partial one
                # keeps it.
                assert r["name"] in ("Keep Me", "__keep__"), f"{phase}: name lost"
                assert r["group"] == "base", f"{phase}: group lost"
                assert r["layerSame"] is True, f"{phase}: layer lost"
                assert r["paneName"] == "customPane", f"{phase}: paneName lost"
                # The value must be the registered icon, unchanged by the
                # partial re-register.
                assert r["iconSvg"] == svg, f"{phase}: iconSvg lost"

    def test_extract_points_api(self, browser, tmp_path):
        """extractPoints returns geo points from registered layers."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/extract_points"))
            assert result is not None
            assert result["count"] == 2, f"Expected 2 points, got {result['count']}"
            assert abs(result["lat0"] - 26.08) < 0.001
            assert abs(result["lng0"] - 119.30) < 0.001
            assert abs(result["lat1"] - 26.09) < 0.001
            assert abs(result["lng1"] - 119.31) < 0.001

    def test_fold_svg_switches_on_toggle(self, browser, tmp_path):
        """Fold button uses a single SVG rotated 180° by CSS (not swapped) on toggle."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_svg.html"
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

            # Single SVG, 1 path before fold (SVGO converts polyline → path)
            elem_count = page.evaluate(_js("LayerControl/count_fold_paths"))
            assert elem_count == 1, f"Expected 1 path (FOLD SVG), got {elem_count}"

            # Click to fold
            page.evaluate(_js("LayerControl/click_overlay_fold_button"))
            page.wait_for_timeout(300)

            # Still 1 path — icon is rotated by CSS, not swapped
            elem_count = page.evaluate(_js("LayerControl/count_fold_paths"))
            assert elem_count == 1, (
                f"Expected 1 path (CSS-rotated, not swapped), got {elem_count}"
            )
            # Row must carry the folded class so CSS rotation kicks in
            is_folded = page.evaluate(_js("LayerControl/read_fold_row_class"))
            assert is_folded, "Expected foliplus-layer-folded class on row after fold"

    def test_color_layer_pointer_cursor(self, browser, tmp_path):
        """Color layer item shows move cursor on hover (draggable in base group)."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            cursor = page.evaluate(_js("LayerControl/read_color_layer_cursor"))
            assert cursor == "move", f"Expected move cursor, got {cursor}"

    # ── Indeterminate checkbox browser tests ──

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

    def test_click_one_overlay_no_sibling_checkbox_flash(self, browser, tmp_path):
        """Clicking one overlay row's checkbox must not flash its group siblings'
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

    def test_paneset_reset_after_hide_show(self, browser, tmp_path):
        """Hiding and re-showing a layer re-pins the leaf marker to its sub-pane.

        Uses a FeatureGroup with a child marker — the marker (leaf) is what
        gets pinned, so the pane value is asserted on the leaf layer. An empty
        container has no DOM to pin, so the assertion is meaningless there.
        """
        fg = folium.FeatureGroup(name="TestLayer", overlay=True, show=True)
        folium.Marker([26.08, 119.30], name="test_marker").add_to(fg)
        with use_page(self._make_page, browser, tmp_path, fg, slug="paneset_reset") as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            # Step 1: enforceOrder pins the leaf marker to the group's sub-pane
            result = page.evaluate(_js("LayerControl/read_leaf_paneset"))
            assert result is not None, "Layer not found"
            assert result["pane"], (
                f"Expected non-empty pane on leaf after enforceOrder, got {result['pane']}"
            )

            # Step 2: Hide the layer by unchecking checkbox
            page.evaluate(_js("LayerControl/click_first_checkbox"))
            page.wait_for_timeout(300)

            # Step 3: Show the layer again
            page.evaluate(_js("LayerControl/click_first_checkbox"))
            page.wait_for_timeout(300)

            # Step 4: handleChange resets the container pane; enforceOrder
            # re-pins the leaf marker to the group's sub-pane
            paneset = page.evaluate(_js("LayerControl/read_leaf_paneset_value"))
            assert paneset, (
                f"Expected non-empty pane on leaf after re-show, got {paneset}"
            )

    def test_enforce_order_end_to_end(self, browser, tmp_path):
        """enforceOrder applies correct z-index to layers and migrates panes."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="Overlay", overlay=True, show=True),
            folium.TileLayer("CartoDB positron", name="Base", overlay=False),
            slug="enforce",
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/read_pane_zindex"))
            assert result is not None, "LayerAPI not found"
            assert result["layerCount"] >= 2, f"got {result['layerCount']} layers"
            # Leaflet sets z-index via CSS class, so computed style should be numeric
            assert result["overlayZ"] and result["overlayZ"] != "auto", (
                "overlay pane should have z-index"
            )
            assert result["markerZ"], "marker pane should have z-index"

    def test_pane_zindex_hierarchy(self, browser, tmp_path):
        """LayerControl keeps data < marker < tooltip < popup z-index ordering.

        Regression: markers (search/locate pins, ✕, data markers) must render
        above LayerControl-managed data layers, while tooltip/popup stay on top.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
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
                name="Polygons",
            ),
            folium.Marker([26.08, 119.30], name="Points"),
        ) as (page, errors):
            # GeoJSON's layer is resolved after its addTo fires layeradd →
            # debouncedEnforce; wait for the per-layer pane to appear. The pane
            # class is "foliplus-layer-pane" (a single token), not "foliplus-layer".
            page.wait_for_selector(
                ".leaflet-pane.foliplus-layer-pane", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/read_pane_zindex"))
            assert result is not None, "LayerAPI not found"
            assert result["dataZ"] is not None, "no data layer pane found"
            assert result["markerZNum"] > result["dataZ"], (
                f"marker({result['markerZNum']}) should be above data "
                f"({result['dataZ']})"
            )
            assert result["tooltipZ"] > result["markerZNum"], (
                f"tooltip({result['tooltipZ']}) should be above marker "
                f"({result['markerZNum']})"
            )
            assert result["popupZ"] > result["tooltipZ"], (
                f"popup({result['popupZ']}) should be above tooltip "
                f"({result['tooltipZ']})"
            )
            assert not errors, f"JS errors: {errors}"

    def test_bring_layer_to_front_guard(self, browser, tmp_path):
        """bringLayerToFront is a no-op for base layers or when already at front."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="Overlay", overlay=True, show=True),
            folium.TileLayer("CartoDB positron", name="Base", overlay=False),
            slug="bringfront_guard",
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/bring_to_front_unknown_guard"))
            assert result is not None
            assert result["unknownOk"] is True, (
                "bringToFront should be safe for unknown id"
            )

    def test_migrate_container_keeps_clean_options(self, browser, tmp_path):
        """Container layers are not re-migrated to fallback panes.

        pinLateContent must skip container nodes when writing pane options.
        The container's own pane stays whatever registerLayer assigned
        (paneName), and must NOT be overwritten with a fallback
        `foliplus-pane-*` name during migration.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/migrate_container_clean_options"))
            assert result is not None
            assert result["leafPane"] == "__clean_graph__", (
                f"Leaf layer not migrated: {result['leafPane']}"
            )
            # Container must not be dumped into a per-layer fallback pane
            assert not result["isFallback"], (
                f"Container polluted with fallback pane: {result['containerPane']}"
            )
            # Leaf path must be rendered
            assert result["leafHasPath"] is True, "Leaf path not rendered"

    def test_register_idempotent_keeps_order(self, browser, tmp_path):
        """Re-registering an existing layer must not reorder the list.

        MeasureControl.setMode calls layers.register() on every tool switch;
        registerLayer on an already-registered id must update fields in place
        instead of splice+unshift, which would silently destroy the user's
        drag order and persist the accidental order via saveOrder.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/register_idempotent_keeps_order"))
            assert result is not None, "LayerAPI not found"
            assert not result["moved"], (
                f"Re-register reordered layers: {result['orderBefore']} -> {result['orderAfter']}"
            )

    def test_render_initial_list_incremental(self, browser, tmp_path):
        """registerLayer on an existing UI must not rebuild the whole list.

        renderInitialList currently wipes innerHTML and re-creates every item,
        which is O(n) per registration (O(n^2) for n registrations). A
        registered layer should insert a single DOM item instead.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/render_initial_list_incremental"))
            assert result is not None, "LayerAPI not found"
            # After the initial attachUI render (1 call), dynamic registrations
            # must not trigger additional full rebuilds.
            assert result["afterSecond"] <= 1, (
                f"registerLayer triggered full rebuilds: {result['afterSecond']}"
            )

    def test_handle_change_resets_paneset_on_show(self, browser, tmp_path):
        """Checkbox toggle triggers handleChange which re-pins layers."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )

            result = page.evaluate(_js("LayerControl/handle_change_resets_paneset"))
            assert result is not None
            assert result["clicked"] is True, "checkbox should be clickable"

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

    def test_keydown_up_moves_focus(self, browser, tmp_path):
        """ArrowUp moves keyboard focus to the previous layer row."""
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
            result = page.evaluate(_js("LayerControl/keydown_up_moves_focus"))
            assert result is not None, "keydown_up_moves_focus failed"
            assert result["focusedElement"] == result["expectedElement"], (
                f"ArrowUp should focus previous item, got {result}"
            )

    def test_keydown_down_moves_focus(self, browser, tmp_path):
        """ArrowDown moves keyboard focus to the next layer row."""
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
            result = page.evaluate(_js("LayerControl/keydown_down_moves_focus"))
            assert result is not None, "keydown_down_moves_focus failed"
            assert result["focusedElement"] == result["expectedElement"], (
                f"ArrowDown should focus next item, got {result}"
            )

    def test_row_cursor_renders_glow_on_clear_surface(self, browser, tmp_path):
        """The Row-cursor recipe genuinely renders, not just exists in source.

        The shared recipe must produce the arrow-key reference look in the live
        DOM — explicit white surface + red glow — for BOTH the keyboard cursor
        and mouse hover, and leave resting rows untouched. This guards against a
        recipe that parses but never paints (the pytest source assert can't
        catch that).

        `show=False` is NOT a reliable "unchecked" pin: on folium 0.14 those
        overlays still land on the map and the init pass still marks the row
        `.foliplus-active` (wash). Force the checkbox off and measure that live row.
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
            page.wait_for_selector(
                ".foliplus-layer-item", state="attached", timeout=5000
            )
            # The row surface is compared against this row's own resting state,
            # which is only meaningful once the init pass has run: rows render
            # checked by default and initLayerItem (on an init timer) decides
            # the checkbox and the .foliplus-active class.
            panel_ready(page)
            # Force a truly unchecked row — do not trust show=False across
            # folium versions (0.14 still checks them).
            page.evaluate(_js("LayerControl/force_first_checkbox_unchecked"))
            # Move the mouse off the panel so a data row reads its resting state.
            page.mouse.move(0, 0)
            page.wait_for_timeout(120)

            rest = page.evaluate(_js("LayerControl/read_row_rest_with_active"))
            assert rest["active"] is False, (
                f"reference row must be unchecked after the forced toggle, got {rest}"
            )
            assert rest["shadow"] == "none", (
                f"resting row must have no glow, got {rest['shadow']}"
            )

            kb = page.evaluate(_js("LayerControl/read_row_cursor_style"))
            assert kb is not None and "error" not in kb, f"cursor snippet failed: {kb}"
            white = self._sample_neutral0(page)
            assert kb["bg"] == white, (
                f"keyboard cursor must paint the white surface, "
                f"got {kb['bg']} vs token {white}"
            )
            assert rest["bg"] == white, (
                f"unchecked rest row must also be the explicit white surface, "
                f"got {rest['bg']} vs token {white}"
            )
            assert kb["shadow"] != "none", (
                f"keyboard-cursor row must glow, got {kb['shadow']}"
            )
            assert kb["outline"] == "none", (
                f"keyboard-cursor row must suppress the default dark outline, got "
                f"{kb['outline']} (black frame)"
            )

            # Hover a data row and confirm it matches the keyboard cursor exactly.
            page.hover(".foliplus-layer-item")
            page.wait_for_timeout(120)
            hover = page.evaluate(_js("LayerControl/read_row_rest"))
            assert hover["bg"] == kb["bg"], (
                f"hover {hover['bg']} must equal keyboard {kb['bg']}"
            )
            assert hover["shadow"] == kb["shadow"], (
                f"hover glow {hover['shadow']} must equal keyboard {kb['shadow']}"
            )

    def test_row_cursor_turns_row_white_on_hover_tab_and_arrow(self, browser, tmp_path):
        """Hover, Tab and arrow-key cursor all turn the row white.

        The interaction target always paints `var(--foliplus-neutral-0)` — including on
        a checked row, whose `.foliplus-active` wash is only the rest surface. White is
        sampled from the token live, never hardcoded. Dropping the class (what
        Escape does) returns the rest surface. Tab is covered by the focusin
        delegate mapping onto the same JS class the probe applies.
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
            panel_ready(page)
            page.mouse.move(0, 0)
            result = page.evaluate(_js("LayerControl/read_row_cursor_surface"))
            assert result is not None and "error" not in result, (
                f"surface snippet failed: {result}"
            )
            white = result["white"]

            # Unchecked: rest and cursor are both the explicit white surface.
            assert result["rest"]["bg"] == white, (
                "unchecked rest must be the explicit white surface, got " + str(result)
            )
            assert result["cursor"]["bg"] == white, (
                "cursor must keep the unchecked row white, got " + str(result)
            )
            assert result["cursor"]["shadow"] != "none", (
                "cursor must still glow, got " + str(result)
            )
            assert result["after"]["bg"] == result["rest"]["bg"], (
                "dropping the cursor class must restore rest, got " + str(result)
            )

            # Checked: rest wash → cursor white → wash returns.
            assert result["checkedRest"]["active"] is True, (
                "reference row should be checked, got " + str(result)
            )
            assert result["checkedRest"]["bg"] != white, (
                "checked rest must show the wash, not the interaction white, got "
                + str(result)
            )
            assert result["checkedCursor"]["bg"] == white, (
                "cursor must also turn a checked row white, got " + str(result)
            )
            assert result["checkedAfter"]["bg"] == result["checkedRest"]["bg"], (
                "dropping the cursor class must restore the checked wash, got "
                + str(result)
            )

            # Real hover on the unchecked row: same white as the JS cursor class.
            page.hover(".foliplus-layer-item:not(.foliplus-active)")
            page.wait_for_timeout(120)
            hover_bg = page.evaluate(_js("LayerControl/read_inactive_row_bg"))
            assert hover_bg == white, (
                f"mouse hover must turn the row white too, got {hover_bg}"
            )

    def test_fold_row_cursor_wakes_glow_and_red_icon(self, browser, tmp_path):
        """A keyboard cursor on the fold (toggle-all) row shows the shared recipe
        (white surface + glow) and wakes the fold icon red, exactly like hover —
        the fold row joins the Row-cursor recipe and cannot drift into its own
        hover style.
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
            result = page.evaluate(_js("LayerControl/read_fold_row_cursor_style"))
            assert result is not None and "error" not in result, (
                f"fold-cursor snippet failed: {result}"
            )
            assert result["isFold"] is True, (
                f"cursor should be on the fold row, got {result}"
            )
            white = self._sample_neutral0(page)
            assert result["bg"] == white, (
                f"fold row cursor must paint the white surface, got {result['bg']}"
            )
            assert result["shadow"] != "none", (
                f"fold row must glow, got {result['shadow']}"
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
            # After keyboard nav the browser may still treat the next mouse
            # focus as :focus-visible, so focusin can light the row — allowed.
            # The hard contract is Enter targets the clicked row (`toggled`).

    def test_keydown_nav_survives_fold_click(self, browser, tmp_path):
        """Folding a group must not kill keyboard navigation.

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
                f"Folding a group should not destroy the keyboard cursor, got {result}"
            )
            assert result["focusInPanel"] is True, (
                f"Folding a group should keep DOM focus inside the panel, got {result}"
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

    def test_keydown_escape_clears_focus(self, browser, tmp_path):
        """Escape clears the keyboard-active focus state."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            # The style assertions below need the init pass done: rows render
            # checked by default and initLayerItem (on an init timer) is what
            # adds the .foliplus-active class and the per-state titles.
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/keydown_escape_clears_focus"))
            assert result is not None, "keydown_escape_clears_focus failed"
            assert result["beforeEscape"] is True, "ArrowDown should first set focus"
            assert result["focusCleared"] is True, (
                f"Escape should clear focus, got {result}"
            )
            assert result["focusRetained"] is True, (
                "Escape must not blur to <body>, got " + str(result)
            )
            assert result["checkedRetainedFocus"] is True, (
                "the checked row must keep DOM focus through Escape, got " + str(result)
            )
            assert result["glowVisibleBefore"] is True, (
                "the cursor glow must be drawn before Escape (the JS class was "
                "on the row), got " + str(result)
            )
            assert result["washRestored"] is True, (
                "a checked row gets its selected wash back through Escape, got "
                + str(result)
            )
            assert result["iconKeptBlack"] is True, (
                "a checked row keeps its black type icon through Escape, got "
                + str(result)
            )
            assert result["glowCleared"] is True, (
                "Escape must clear the cursor-only glow, got " + str(result)
            )
            assert result["outlineCleared"] is True, (
                "Escape must not leave the browser default dark outline on the "
                "still-focused row, got " + str(result)
            )

            # A real hover must still light the recipe on the cancelled row:
            # the recipe keys on :hover + the JS class, and Escape only lifts
            # the class. Cancel the cursor again for a deterministically
            # cancelled row, hover with the real pointer, then move it away
            # and assert the fall-back.
            page.evaluate(_js("LayerControl/dispatch_escape_on_active"))
            page.hover(".foliplus-layer-item.foliplus-active")
            # The grip is the one recipe property with an opacity transition
            # (color/box-shadow are transition: none), so wait it out before
            # measuring or the computed value is mid-flight.
            page.wait_for_function(
                _js("LayerControl/wait_drag_handle_opacity"),
                arg=[
                    ".foliplus-layer-item.foliplus-active .foliplus-drag-cell .drag-handle",
                    0,
                    "1",
                ],
                timeout=2000,
            )
            on_hover = page.evaluate(_js("LayerControl/read_active_row_lit"))
            page.mouse.move(5, 400)
            page.wait_for_function(
                _js("LayerControl/wait_drag_handle_opacity"),
                arg=[
                    ".foliplus-layer-item.foliplus-active .foliplus-drag-cell .drag-handle",
                    0,
                    "0",
                ],
                timeout=2000,
            )
            off_hover = page.evaluate(_js("LayerControl/read_active_row_state"))
            assert on_hover["grip"] == "1", (
                "hovering the cancelled row must show the drag grip, got "
                + str(on_hover)
            )
            assert on_hover["glow"] is True, (
                "hovering the cancelled row must light the glow, got " + str(on_hover)
            )
            assert on_hover["more"] == off_hover["more"], (
                "a checked row keeps the more button in the action color at "
                "rest and on hover alike (its .foliplus-active leg), got "
                + str(on_hover)
                + " vs "
                + str(off_hover)
            )
            assert off_hover["grip"] == "0", (
                "leaving the row must hide the grip again, got " + str(off_hover)
            )
            assert off_hover["bg"] not in ("rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"), (
                "leaving the row must fall back to the selected wash, got "
                + str(off_hover)
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
            white = self._sample_neutral0(page)

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

    def test_keydown_escape_keeps_focus_in_row(self, browser, tmp_path):
        """Escape while the row holds DOM focus lifts the cursor class in place.

        The rename-cancel path is covered by the vitest suite; this browser
        probe pins the real-Chromium contract: class off, focus still inside
        the row, no residual suppress marker.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(
                _js("LayerControl/keydown_escape_keeps_focus_in_row")
            )
            assert result is not None, "keydown_escape_keeps_focus_in_row failed"
            assert result["cursorCleared"] is True, (
                "Escape should clear the cursor, got " + str(result)
            )
            assert result["focused"] is True, (
                "Escape must keep DOM focus inside the row, got " + str(result)
            )
            assert result["suppressLeft"] is False, (
                "the FOCUS_SUPPRESSED mechanism is gone, got " + str(result)
            )

    def test_native_gate_range_slider_arrowdown(self, browser, tmp_path):
        """ArrowDown on a focused zoom-range slider moves the thumb, never the row cursor.

        Row 1 of the input-ownership table, exercised through Chromium's real
        keyboard pipeline: the key is pressed with ``page.keyboard`` after a
        real focus, and a capture listener reports the browser's final
        ``defaultPrevented``. Both halves of the gate are measured — the native
        behavior actually happened, and foliplus did not cancel the key to
        take it over. Synthetic ``dispatchEvent`` cannot prove either.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, errors):
            panel_ready(page)
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            arm = page.evaluate(_js("LayerControl/native_gate_arm"))
            assert arm.get("error") is None, f"setup failed: {arm}"
            assert arm["sliderBefore"] > arm["sliderMin"], (
                "the thumb rests on its floor, so ArrowDown has nowhere to go: "
                + str(arm)
            )
            assert arm["focusedTag"] == "wa-slider", f"slider not focused: {arm}"

            page.keyboard.press("ArrowDown")

            mid = page.evaluate(_js("LayerControl/native_gate_mid"))
            assert mid["sliderAfter"] == arm["sliderBefore"] - arm["sliderStep"], (
                "the thumb did not step down natively: before="
                + str(arm["sliderBefore"])
                + " after="
                + str(mid["sliderAfter"])
            )
            read = page.evaluate(_js("LayerControl/native_gate_read"))
            recs = [r for r in (read["records"] or []) if r["key"] == "ArrowDown"]
            assert len(recs) == 1, (
                f"ArrowDown observed {len(recs)} times: {read['records']}"
            )
            assert recs[0]["prevented"] is False, (
                "foliplus cancelled ArrowDown meant for the slider: "
                + str(read["records"])
            )
            assert recs[0]["tag"] == "wa-slider", str(read["records"])
            # The cursor is compared against its pre-press baseline, not against
            # "absent": opening the style panel and focusing the checkbox both
            # legitimately light the row cursor, so only a change is in scope.
            assert mid["rowFocused"] == arm["rowFocused"], (
                "the row keyboard cursor moved while the slider was focused: "
                "before=" + str(arm["rowFocused"]) + " after=" + str(mid["rowFocused"])
            )
            assert not errors, f"JS errors: {errors}"

    def test_native_gate_checkbox_space(self, browser, tmp_path):
        """Space on a focused row checkbox flips it exactly once, via the native path.

        Row 2 of the table. foliplus owns no key of a checkbox, so its own
        row-toggle shortcut must not run alongside the native flip — otherwise
        the layer would be applied twice. A real keypress again, with the
        final ``defaultPrevented`` read from a capture listener.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, errors):
            panel_ready(page)
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            arm = page.evaluate(_js("LayerControl/native_gate_arm"))
            assert arm.get("error") is None, f"setup failed: {arm}"
            mid = page.evaluate(_js("LayerControl/native_gate_mid"))
            assert mid["cbType"] == "checkbox", f"not a checkbox: {mid}"
            assert mid["focusedType"] == "checkbox", f"checkbox not focused: {mid}"

            page.keyboard.press(" ")

            read = page.evaluate(_js("LayerControl/native_gate_read"))
            recs = [r for r in (read["records"] or []) if r["type"] == "checkbox"]
            assert recs, "no keydown reached document while the checkbox was focused"
            assert len(recs) == 1, (
                f"Space observed {len(recs)} times: {read['records']}"
            )
            assert recs[0]["prevented"] is False, (
                "foliplus cancelled the Space the checkbox was flipping on: "
                + str(read["records"])
            )
            assert read["cbAfter"] is not None, str(read)
            assert read["cbAfter"] != mid["cbBefore"], (
                "the checkbox did not flip: before="
                + str(mid["cbBefore"])
                + " after="
                + str(read["cbAfter"])
            )
            # Baseline is the cursor left by the checkbox focus itself, which is
            # the cursor by design: only a change caused by the keypress counts.
            assert read["rowFocused"] == mid["rowFocusedAfterFocus"], (
                "the row keyboard cursor moved on the Space that the checkbox "
                "was flipping on: after-focus="
                + str(mid["rowFocusedAfterFocus"])
                + " after-press="
                + str(read["rowFocused"])
            )
            assert not errors, f"JS errors: {errors}"

    def test_focusin_maps_checkbox_to_row_cursor(self, browser, tmp_path):
        """Tab focus is sampled once in focusin and mapped onto the JS row class.

        :focus-visible is not a CSS trigger. Keyboard-modality focus on a child
        control lights the owning row; mouse-modality focus must not. Escape
        then lifts the class with no residual suppress marker.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(
                _js("LayerControl/focusin_maps_checkbox_to_row_cursor")
            )
            assert result is not None, "focusin_maps_checkbox_to_row_cursor failed"
            assert result["litByKeyboard"] is True, (
                "keyboard-modality focus must light the owning row, got " + str(result)
            )
            assert result["litByMouse"] is False, (
                "mouse-modality focus must not light the row, got " + str(result)
            )
            assert result["suppressLeft"] is False, (
                "the FOCUS_SUPPRESSED mechanism is gone, got " + str(result)
            )

    def test_checkbox_click_lights_row_cursor(self, browser, tmp_path):
        """Click lights the row cursor and keeps it until another row takes over.

        Pointer click is a cursor arrival (white + glow). Repeated clicks stay
        on the same row; clicking another row hands the visual over.
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
            page.mouse.move(0, 0)
            result = page.evaluate(_js("LayerControl/checkbox_click_lights_cursor"))
            assert result is not None and "error" not in result, (
                f"checkbox click snippet failed: {result}"
            )
            assert result["afterClick"]["focusedClass"] is True, (
                "click must light the row cursor, got " + str(result)
            )
            assert result["afterClick"]["glow"] is True, (
                "click must show the cursor glow, got " + str(result)
            )
            assert result["afterAgain"]["focusedClass"] is True, (
                "repeated clicks must keep the cursor, got " + str(result)
            )
            assert result["handedOver"]["first"]["focusedClass"] is False, (
                "clicking another row must drop the previous cursor, got " + str(result)
            )
            assert result["handedOver"]["second"]["focusedClass"] is True, (
                "the clicked row must carry the cursor, got " + str(result)
            )

    def test_base_basemap_quiet_focus(self, browser, tmp_path):
        """Base basemap / color rows show no cursor glow; overlay rows still do.

        Basemaps are stack slots, not data layers — click / keyboard focus
        must not paint the white+glow recipe. Mouse cursor stays default.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        base = folium.TileLayer("OpenStreetMap", name="OSM", overlay=False)
        with use_page(self._make_page, browser, tmp_path, overlay, base) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            page.mouse.move(0, 0)
            result = page.evaluate(_js("LayerControl/base_basemap_quiet_focus"))
            assert result is not None and "error" not in result, (
                f"base basemap snippet failed: {result}"
            )
            # Checked base row: no glow, not white — keep the visibility wash.
            assert result["baseCheckedHover"]["glow"] is False, (
                "base basemap must not show the cursor glow, got " + str(result)
            )
            assert result["baseCheckedHover"]["cursor"] == "default", (
                "base basemap hover must keep the default cursor, got " + str(result)
            )
            assert result["baseCheckedHover"]["bg"] == result["wash"], (
                "checked base row must keep the wash on hover, got " + str(result)
            )
            assert result["baseCheckedHover"]["bg"] != result["white"], (
                "checked base row must not flash white on hover, got " + str(result)
            )
            # Overlay data row still gets the full recipe.
            assert result["overlayAfter"]["glow"] is True, (
                "overlay row must still show the cursor glow, got " + str(result)
            )
            # Color picker row is quiet when present.
            if result["colorAfter"] is not None:
                assert result["colorAfter"]["glow"] is False, (
                    "color picker row must not show the cursor glow, got " + str(result)
                )

    def test_checkbox_dblclick_does_not_focus_layer(self, browser, tmp_path):
        """Two quick checkbox toggles must not zoom the map (focusLayer).

        The browser fires `dblclick` after the second click. That event used
        to bubble to the panel handler and open the focus-layer overlay.
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=[[26.0, 119.2], [26.2, 119.2], [26.2, 119.5], [26.0, 119.5]],
        ).add_to(fg)
        with use_page(self._make_page, browser, tmp_path, fg) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/checkbox_dblclick_no_focus_layer"))
            assert result is not None and "error" not in result, (
                f"checkbox dblclick snippet failed: {result}"
            )
            assert result["focusing"] is False, (
                "double-click on checkbox must not mark the row as focusing, got "
                + str(result)
            )
            assert result["mask"] is False, (
                "double-click on checkbox must not draw the focus mask, got "
                + str(result)
            )
            assert result["focusActive"] is False, (
                "double-click on checkbox must not activate the focus overlay, got "
                + str(result)
            )

    def test_focus_layer_draws_rect_and_mask(self, browser, tmp_path):
        """Double-clicking an overlay draws the dashed rect + inverse mask."""
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=[[26.0, 119.2], [26.2, 119.2], [26.2, 119.5], [26.0, 119.5]],
        ).add_to(fg)
        with use_page(self._make_page, browser, tmp_path, fg, slug="focus_overlay") as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/focus_layer_draws_overlay"))
            assert result is not None, "focus_layer_draws_overlay failed"
            assert result["rectDrawn"] is True, f"focus rect missing, got {result}"
            assert result["maskDrawn"] is True, f"focus mask missing, got {result}"
            assert result["rowHighlighted"] is True, (
                f"row not highlighted, got {result}"
            )

    def test_focus_mask_covers_viewport_after_fitbounds_zoomout(
        self, browser, tmp_path
    ):
        """A small container at high zoom focusing a wide layer must not leave
        un-dimmed strips outside the mask.

        The mask's outer ring is drawn once from
        ``map.getBounds().pad(1)`` *before* ``fitBounds`` runs. When
        ``fitBounds`` zooms out to fit a wide layer into a small container,
        the new viewport spans far more geography than the pre-animation
        outer ring — the dim stops at the old boundary and bright strips
        leak around the corners. The fix draws the outer ring as the
        Web-Mercator world envelope so it covers any viewport at any zoom.
        """
        # 20°x20° polygon: much wider than a small container at zoom 16,
        # so ``fitBounds`` must zoom out to fit it.
        fg = folium.FeatureGroup(name="Wide", overlay=True, show=True)
        folium.Polygon(
            locations=[[20, 110], [40, 110], [40, 130], [20, 130], [20, 110]],
        ).add_to(fg)
        m = folium.Map(location=[26.08, 119.30], zoom_start=16)
        LayerControl().add_to(m)
        fg.add_to(m)
        html = m.get_root().render()
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found in rendered HTML"
        with use_page(
            make_browser_page, browser, tmp_path, html, "focus_mask_ghost"
        ) as (page, _):
            page.set_viewport_size({"width": 320, "height": 240})
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            item = page.query_selector(".foliplus-layer-item")
            assert item is not None, "no layer row rendered"
            item.dispatch_event("dblclick")
            # fitBounds animates for 600ms; registerAutoCancel gives a
            # 1050ms grace period after the animation. Read inside that
            # window so the mask is still live.
            page.wait_for_timeout(1100)
            result = page.evaluate(_js("LayerControl/focus_mask_covers_viewport"))
            assert result is not None, "focus_mask_covers_viewport failed"
            assert "error" not in result, f"probe error: {result}"
            assert result["coversViewport"] is True, (
                f"focus mask outer ring must cover the post-fitBounds "
                f"viewport: outer={result['outer']} vs view={result['view']} "
                f"at zoom={result['zoom']}"
            )

    def test_focus_rect_is_marching_ants(self, browser, tmp_path):
        """The focus rect paints the shared marching-ants look, live.

        Pins the three cascade facts a regression can silently drop: accent
        stroke (not Leaflet's default, not a black fallback), the shared
        ``--foliplus-dash-rhythm``, and the march animation. Tokens are
        sampled from the live page — never hardcoded — so a broken custom
        property fails here instead of only in a human eye.
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=[[26.0, 119.2], [26.2, 119.2], [26.2, 119.5], [26.0, 119.5]],
        ).add_to(fg)
        with use_page(
            self._make_page, browser, tmp_path, fg, slug="focus_rect_ants"
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
            result = page.evaluate(_js("LayerControl/focus_rect_marching_ants"))
            assert result is not None, "focus_rect_marching_ants failed"
            assert result["rectDrawn"] is True, f"focus rect missing, got {result}"

            accent = self._sample_token(page, "--foliplus-accent-primary")
            dash = page.evaluate(_js("LayerControl/read_dash_rhythm"))
            assert result["stroke"] == accent, (
                f"focus rect stroke must be the accent token, "
                f"got {result['stroke']} vs {accent}"
            )
            assert result["fill"] in ("none", "rgba(0, 0, 0, 0)"), (
                f"focus rect must stay unfilled, got {result['fill']}"
            )
            # strokeDasharray is normalized ("6px, 4px"); the token is
            # space-separated ("6px 4px"). Compare as token lists.
            got_dash = result["strokeDasharray"].replace(",", " ").split()
            want_dash = dash.replace(",", " ").split()
            assert got_dash == want_dash, (
                f"focus rect dash rhythm must be {want_dash}, got {got_dash}"
            )
            assert result["animationName"] == "foliplus-focus-march", (
                f"focus rect must keep the march animation, got {result}"
            )

    def test_geometry_focus_drops_ua_ring_for_marching_ants(self, browser, tmp_path):
        """A focused map path paints a marching-ants bbox, not a stroke restyle.

        The UA ring is black on Windows Chrome and system-blue on macOS Chrome
        (outline-style: auto + Highlight). The selection signal is the same
        marquee as the LayerControl focus rect, so line data keeps its stroke.
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=[[26.0, 119.2], [26.2, 119.2], [26.2, 119.5], [26.0, 119.5]],
        ).add_to(fg)
        with use_page(
            self._make_page, browser, tmp_path, fg, slug="geom_focus_ants"
        ) as (page, _):
            page.emulate_media(reduced_motion="no-preference")
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/geometry_focus_marching_ants"))
            assert result is not None, "geometry_focus_marching_ants failed"
            assert result["focused"] is True, f"path never took focus, got {result}"
            assert result["outlineStyle"] == "none", (
                f"focused geometry must not paint the UA outline, got {result}"
            )
            assert result["marqueePresent"] is True, (
                f"focused geometry must draw the marching-ants bbox, got {result}"
            )

            accent = self._sample_token(page, "--foliplus-accent-primary")
            dash = page.evaluate(_js("LayerControl/read_dash_rhythm"))
            assert result["marqueeStroke"] == accent, (
                f"marquee stroke must be accent, "
                f"got {result['marqueeStroke']} vs {accent}"
            )
            got_dash = result["marqueeDasharray"].replace(",", " ").split()
            want_dash = dash.replace(",", " ").split()
            assert got_dash == want_dash, (
                f"marquee dash rhythm must be {want_dash}, got {got_dash}"
            )
            assert result["marqueeAnimation"] == "foliplus-focus-march", (
                f"marquee must keep the march animation, got {result}"
            )

    def test_geometry_focus_marquee_survives_zoom(self, browser, tmp_path):
        """Focused geometry's marching-ants bbox stays locked to the geometry
        across a zoom change.

        #668 wired the marquee to re-derive from the live bbox on `moveend`,
        but `getBBox()` is cached by the browser's SVG layout engine and only
        refreshes on the next frame. A synchronous redraw inside `moveend`
        reads the pre-zoom bbox and the marquee freezes at the old position.
        The fix defers the redraw with `requestAnimationFrame`. This test
        captures real pixel bboxes before and after a zoom and asserts the
        marquee tracks the geometry within 1px (plus the 4px pad).
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=[[26.0, 119.2], [26.2, 119.2], [26.2, 119.5], [26.0, 119.5]],
        ).add_to(fg)
        with use_page(
            self._make_page, browser, tmp_path, fg, slug="geom_focus_zoom_lock"
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/geometry_focus_zoom_stays_locked"))
            assert result is not None and "before" in result, (
                f"geometry_focus_zoom_stays_locked failed: {result}"
            )
            before, after = result["before"], result["after"]
            assert after is not None, f"zoom moveend never fired within 5s: {result}"
            assert after["marqueeBB"] is not None, (
                f"marquee vanished after zoom: {result}"
            )
            # The marquee is the geometry bbox + 4px pad on all sides.
            pad = 4
            tol = 1.0
            gb, mb = before["geomBB"], before["marqueeBB"]
            assert abs(mb["x"] - (gb["x"] - pad)) <= tol, (
                f"before zoom: marquee left edge {mb['x']} != geom {gb['x']} - pad {pad}"
            )
            assert abs(mb["y"] - (gb["y"] - pad)) <= tol, (
                f"before zoom: marquee top edge {mb['y']} != geom {gb['y']} - pad {pad}"
            )
            gb, mb = after["geomBB"], after["marqueeBB"]
            assert abs(mb["x"] - (gb["x"] - pad)) <= tol, (
                f"AFTER zoom: marquee left edge {mb['x']} != geom {gb['x']} - pad {pad} "
                f"(marquee froze at old position)"
            )
            assert abs(mb["y"] - (gb["y"] - pad)) <= tol, (
                f"AFTER zoom: marquee top edge {mb['y']} != geom {gb['y']} - pad {pad} "
                f"(marquee froze at old position)"
            )
            assert abs(mb["w"] - (gb["w"] + 2 * pad)) <= tol, (
                f"AFTER zoom: marquee width {mb['w']} != geom {gb['w']} + 2*pad"
            )
            assert abs(mb["h"] - (gb["h"] + 2 * pad)) <= tol, (
                f"AFTER zoom: marquee height {mb['h']} != geom {gb['h']} + 2*pad"
            )

    def test_focus_overlay_pane_keeps_spotlight_visible(self, browser, tmp_path):
        """The focus overlay pane carries both the base and exclusion classes.

        Every foliplus-owned pane goes through ``PaneManager.ensurePane``, so
        the overlay pane carries ``foliplus-layer-pane`` — the semantic marker
        that the pane belongs to us and the interaction rules in focus.css
        apply uniformly. The focused-layer rule
        ``.foliplus-is-focus-mode .foliplus-layer-pane:not(.foliplus-focus-pane)``
        would hide it too without the exclusion tag, so ``drawFocusMask`` adds
        ``foliplus-focus-pane`` alongside the base class. This gate reads the
        pane as the code left it, then toggles the exclusion class to prove
        the risk is real (dropping the tag collapses the spotlight).
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=[[26.0, 119.2], [26.2, 119.2], [26.2, 119.5], [26.0, 119.5]],
        ).add_to(fg)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="focus_overlay_pane",
        ) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(
                _js("LayerControl/focus_overlay_pane_hides_with_base_class")
            )
            assert result is not None and result.get("pane") is True, (
                f"focus overlay pane missing after dblclick: {result}"
            )
            assert result["focusActive"] is True, (
                f"container must carry foliplus-is-focus-mode during focus: {result}"
            )
            state = result["state"]
            assert state["base"] is True, (
                "the focus overlay pane must carry the base "
                f"foliplus-layer-pane class: {state}"
            )
            assert state["exclusion"] is True, (
                "the focus overlay pane must carry the foliplus-focus-pane "
                f"exclusion tag so the spotlight is not hidden: {state}"
            )
            assert state["visibility"] == "visible", (
                f"the spotlight pane must stay visible during focus: {state}"
            )
            # Q2 gate: the overlay pane is not in childPaneSpecs, so
            # ensurePane skips its provisional-z branch and drawFocusMask pins
            # FOCUS_Z.overlay itself. Assert the pin held AND that no other
            # owned pane has climbed to or above it — otherwise the mask would
            # be covered by a data layer and the dim would be silent.
            assert state["zIndex"] == "9000", (
                f"focus overlay pane must sit at FOCUS_Z.overlay (9000), got "
                f"{state['zIndex']!r}"
            )
            assert result["maxPeerZ"] < 9000, (
                "no other foliplus-layer-pane may sit at or above the focus "
                f"overlay pane (highest peer z={result['maxPeerZ']})"
            )
            # Risk 1, proven: base class alone would hide the pane.
            assert result["withoutExclusion"] == "hidden", (
                "dropping the exclusion tag must hide the overlay pane — this is "
                f"the risk the exclusion tag neutralises: {result}"
            )
            assert result["restored"] == "visible", (
                f"restoring the tag must make the pane visible again: {result}"
            )

    def test_focus_overlay_pane_click_through(self, browser, tmp_path):
        """The focus overlay pane must not intercept pointer events.

        The base ``foliplus-layer-pane`` class carries ``pointer-events: none``
        from focus.css, so the pane div — which the SVG renderer fills across
        the whole map while a focus is live — never eats a click. Without the
        base class the div defaults to ``auto`` and, sitting above every other
        layer pane, it blocks every hit on the focused layer's own features
        during focus: a silent regression the previous shape of the pane
        produced. This gate pins the CSS invariant directly: drop the base
        class (or the rule) and the assertion fires.
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=[[26.0, 119.2], [26.2, 119.2], [26.2, 119.5], [26.0, 119.5]],
        ).add_to(fg)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="focus_overlay_click",
        ) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/focus_overlay_pane_click_through"))
            assert result is not None and result.get("pane") is True, (
                f"focus overlay pane missing after dblclick: {result}"
            )
            assert result["panePointerEvents"] == "none", (
                "the focus overlay pane div must inherit pointer-events: none "
                f"from the base class, got {result['panePointerEvents']!r}"
            )

    def test_focus_keeps_base_panes_visible(self, browser, tmp_path):
        """Basemaps stay visible during focus — they are dimmed, not hidden.

        Before this fix, ``.foliplus-is-focus-mode`` hid every
        ``.foliplus-layer-pane`` except the focused one. The active basemap
        (topmost base layer that is effectiveShown) is exempted via
        `.foliplus-focus-basemap` and stays visible; other base panes and
        overlay data panes are hidden so the focused layer stands out. The
        dim mask on top preserves spatial context.

        The color basemap is created lazily on first show, so we toggle its
        checkbox on before focusing — this also exercises the ``!layer``
        branch of the ordering pass (color basemaps have no Leaflet layer).
        """
        # A tile basemap + an overlay polygon so focus has a target.
        base = folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="OSM",
            attr="OSM",
            overlay=False,
        )
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=[[26.0, 119.2], [26.2, 119.2], [26.2, 119.5], [26.0, 119.5]],
        ).add_to(fg)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            base,
            fg,
            slug="focus_keeps_base_visible",
        ) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            # Turn the color basemap on so its lazily-created pane is in the
            # DOM before we focus.
            toggle = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert toggle is not None and toggle.get("ok") is True, toggle
            page.wait_for_timeout(200)
            result = page.evaluate(_js("LayerControl/focus_keeps_base_panes_visible"))
            assert result is not None and not result.get("error"), (
                f"focus probe failed: {result}"
            )
            assert result["focusActive"] is True, f"focus mode must be active: {result}"
            assert result["maskPanePresent"] is True, (
                f"focus mask pane must exist: {result}"
            )
            # Classify the panes: active basemap, focused layer, and others.
            focus_basemap_panes = [p for p in result["panes"] if p["focusBasemap"]]
            focus_panes = [p for p in result["panes"] if p["focusExcl"]]
            other_panes = [
                p
                for p in result["panes"]
                if not p["focusBasemap"] and not p["focusExcl"]
            ]
            # The active basemap must be present and visible.
            assert len(focus_basemap_panes) >= 1, (
                "the active basemap's pane must be present and marked with "
                f"foliplus-focus-basemap: {result['panes']}"
            )
            for pane in focus_basemap_panes:
                assert pane["visibility"] == "visible", (
                    "the active basemap's pane must stay visible during focus "
                    f"— the dim mask does the dimming, not visibility:hidden: "
                    f"{pane}"
                )
            # The focused layer's pane and the focus overlay pane must be
            # visible.
            assert len(focus_panes) >= 2, (
                "the focused layer's pane and the focus overlay pane must both "
                f"carry foliplus-focus-pane: {result['panes']}"
            )
            for pane in focus_panes:
                assert pane["visibility"] == "visible", (
                    f"a foliplus-focus-pane pane must stay visible: {pane}"
                )
            # Any other pane (including non-active base panes and overlay data
            # layers) must be hidden — otherwise the focused layer is not
            # visually isolated.
            for pane in other_panes:
                assert pane["visibility"] == "hidden", (
                    "a non-focus, non-active-basemap foliplus-layer-pane must "
                    f"be hidden during focus so the focused layer stands out: "
                    f"{pane}"
                )

    def test_focus_basemap_dim_direction(self, browser, tmp_path):
        """The focused basemap interior must NOT be darker than unfocused.

        The dim rule uses `opacity`, which blends the basemap toward the map
        container's background color — the result is lighter, not darker.
        A `filter: brightness(...)` would darken the pane uniformly (including
        the interior), which is the wrong direction: the user expects the
        basemap to fade into the background, not to sink into shadow. This
        pixel-level gate catches a regression where someone changes the rule
        back to a filter.

        The test enables the solid-color basemap because OSM tiles are 404 in
        browser tests — a transparent tile pane makes `opacity` a no-op on the
        pixel, so the gate cannot distinguish the two rules. It samples a pixel
        in the focus rectangle's padding ring: outside the polygon (no overlay
        contamination) but inside the focus rect (no mask), so the delta
        reflects only the basemap's opacity change. The padding ring is 32px
        (FOCUS.PADDING); 15px inside it gives a comfortable margin.
        """
        base = folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="OSM",
            attr="OSM",
            overlay=False,
        )
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=[[26.0, 119.2], [26.2, 119.2], [26.2, 119.5], [26.0, 119.5]],
        ).add_to(fg)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            base,
            fg,
            slug="focus_basemap_direction",
        ) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            # Pan the map to center the polygon so the sample point is inside
            # the viewport. The polygon's top edge is north of the default map
            # center; without panning, the padding-ring sample would be above
            # the viewport (negative y) and the pixel read would be out-of-bounds.
            page.evaluate(_js("LayerControl/pan_to_foliplus"))
            page.wait_for_timeout(500)

            # Enable the solid-color basemap so there is a visible basemap to
            # dim. OSM tiles are 404 in browser tests, so the tile pane is
            # transparent and `opacity` on it would have no visible effect.
            color_result = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert color_result.get("ok") is True, (
                f"failed to enable color basemap: {color_result}"
            )
            # Wait for the color basemap canvas to paint.
            page.wait_for_timeout(300)

            import io

            from PIL import Image

            # Sample the polygon center — inside the polygon (definitely inside
            # the focus rect, so the mask does not apply) and on the basemap
            # underneath (the polygon's fill_opacity=0.5 lets the basemap show
            # through at 50%). The pixel is a blend of polygon fill and basemap;
            # the delta comes only from the basemap's opacity change.
            box = page.evaluate(_js("LayerControl/project_foliplus_latlng"))
            px, py = int(box["x"]), int(box["y"])

            # Capture before focus.
            screenshot_before = page.screenshot()
            img_before = Image.open(io.BytesIO(screenshot_before))
            pixel_before = img_before.getpixel((px, py))

            # Trigger focus by dblclicking the first overlay layer row.
            result = page.evaluate(_js("LayerControl/focus_keeps_base_panes_visible"))
            assert result is not None and not result.get("error"), (
                f"focus probe failed: {result}"
            )
            assert result["focusActive"] is True, f"focus mode must be active: {result}"

            # Capture after focus.
            page.wait_for_timeout(200)  # let the opacity transition settle
            screenshot_after = page.screenshot()
            img_after = Image.open(io.BytesIO(screenshot_after))
            pixel_after = img_after.getpixel((px, py))

            # The focused basemap interior must not be darker than unfocused.
            # With opacity, the pixel blends toward the container background
            # (#ddd ≈ 221), so the focused pixel is lighter. With a filter,
            # it would be darker.
            before_r, before_g, before_b = pixel_before[:3]
            after_r, after_g, after_b = pixel_after[:3]
            for channel, b, a in [
                ("R", before_r, after_r),
                ("G", before_g, after_g),
                ("B", before_b, after_b),
            ]:
                delta = a - b
                assert delta >= 0, (
                    f"the focused basemap interior must not be darker than "
                    f"unfocused in channel {channel}: before={b}, after={a}, "
                    f"delta={delta} — the dim rule must use `opacity` "
                    f"(which blends toward the container background), not "
                    f"`filter` (which darkens uniformly)"
                )

    def test_focus_overlay_renderer_lifecycle(self, browser, tmp_path):
        """Each focus owns exactly one SVG renderer in the overlay pane.

        ``L.svg({ pane })`` builds a fresh renderer that mounts its own ``<svg>``
        into the pane, which lives for the whole map's life. ``dismissFocus``
        uses the public Leaflet teardown path (``map.removeLayer`` on the
        renderer), so every focus cycle must leave the pane empty — the pane
        itself persists (ensurePane memoises it), the renderer does not. The
        control-teardown path (``removeControl`` + ``addControl`` on the same
        control, documented in CLAUDE.md) runs ``dismissFocus`` inside
        ``unbindEvents``, so an in-flight focus must not outlive the removal.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            slug="focus_overlay_lifecycle",
        ) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/focus_overlay_renderer_lifecycle"))
            assert result is not None and result.get("ctrl") is True, (
                f"lifecycle probe failed to run: {result}"
            )
            assert result["before"] == 0, (
                f"the overlay pane should start empty: {result}"
            )
            # One renderer per focus, cleanly removed on cancel.
            for cycle in result["cycles"]:
                assert cycle["row"] is True, f"missing row for {cycle['id']}: {cycle}"
                assert cycle["svg"] == 1, (
                    f"focus should mount exactly one SVG renderer: {cycle}"
                )
                assert cycle["rendererLive"] is True, cycle
                assert cycle["after"]["svg"] == 0, (
                    f"cancel must remove the SVG renderer — a non-zero count is a "
                    f"leak: {cycle}"
                )
                assert cycle["after"]["rendererNull"] is True, cycle
            teardown = result["teardown"]
            assert teardown["svgAtRemove"] == 1, (
                f"an in-flight focus must hold one SVG at the moment of "
                f"removeControl: {teardown}"
            )
            assert teardown["svgAfterRemove"] == 0, (
                f"removeControl must dismiss the in-flight focus, leaving no "
                f"leaked renderer: {teardown}"
            )
            assert teardown["svgAfterAdd"] == 0, (
                f"addControl must not resurrect the removed renderer: {teardown}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_plain_marker_layers_count_and_stay_stable(self, browser, tmp_path):
        """A plain folium.Marker (no GeoJSON .feature) counts as a point feature.

        Regression: countFeatureGeometry / getGeometryType gated on
        ``marker.feature``, so layers built from ``folium.Marker()`` reported a
        count of 0 and showed no type icon.  Counting must not require
        .feature (that only matters for extractPoints / Heatmap properties),
        and toggling an unrelated layer's checkbox must not reset the count.
        """
        layers = []
        for i, name in enumerate(["Alpha", "Beta", "Gamma", "Delta"]):
            fg = folium.FeatureGroup(name=name, overlay=True, show=True)
            folium.Marker([26.08 + i * 0.01, 119.30 + i * 0.01], popup=name).add_to(fg)
            layers.append(fg)

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

    def test_panel_stays_open_on_outside_press_by_default(self, browser, tmp_path):
        """A press on the map does not collapse the panel.

        ``collapse_on_outside`` defaults to ``False``: the panel is a working
        surface read at the same time as the map, and the map's busiest gesture
        is drag-pan / click-select. Hiding a panel the user is actively working
        in because of that gesture is the defect the parameter was added for;
        the header close affordance remains the explicit way to collapse, so
        nothing is lost.

        Replaces the #303 parity guard that asserted the opposite. At the time,
        "LayerControl and HeatmapControl behave the same" was the goal; a panel
        that hides while you work in it turned out to be the bug.

        Events go through Playwright's mouse so the browser does the hit-testing
        and the document-level capture/bubble pair sees real propagation — not a
        ``dispatchEvent`` aimed at the handler.
        """
        layer = folium.FeatureGroup(name="Outside click")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="outside_click"
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)
            assert self._panel_open(page, ".foliplus-layer-ctrl"), "toggle failed"

            page.mouse.click(900, 450)
            page.wait_for_timeout(300)
            assert self._panel_open(page, ".foliplus-layer-ctrl"), (
                "a click on the map collapsed the panel; the default is False"
            )

            page.mouse.down()
            page.mouse.move(760, 380, steps=8)
            page.mouse.up()
            page.wait_for_timeout(300)
            assert self._panel_open(page, ".foliplus-layer-ctrl"), (
                "a drag-pan on the map collapsed the panel; the default is False"
            )
            assert not errors, f"JS errors: {errors}"

    def test_panel_collapses_on_outside_press_when_enabled(self, browser, tmp_path):
        """``collapse_on_outside=True`` re-enables the implicit trigger.

        Proves the parameter is wired end to end — Python constructor -> CONFIG ->
        shell -> ``bindOutsideCollapse`` — rather than accepted and ignored.
        """
        layer = folium.FeatureGroup(name="Outside click on")
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            layer,
            slug="outside_click_on",
            collapse_on_outside=True,
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)
            assert self._panel_open(page, ".foliplus-layer-ctrl"), "toggle failed"

            page.mouse.click(900, 450)
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-collapsed",
                state="attached",
                timeout=5000,
            )
            assert not self._panel_open(page, ".foliplus-layer-ctrl"), (
                "the panel stayed open after an outside press with "
                "collapse_on_outside=True"
            )
            assert not errors, f"JS errors: {errors}"

    def test_row_panel_still_dismisses_on_outside_press(self, browser, tmp_path):
        """The floating attrs panel still dismisses on an outside press.

        The main panel lost its implicit collapse; the row panels are popups,
        where dismissing on an outside press is their only cancel affordance,
        and they dismiss through their own document-capture ``mousedown``
        handler rather than through the shell. This pins that the shell change
        did not take them down with it.
        """
        layer = folium.FeatureGroup(name="Row panel")
        with use_page(self._make_page, browser, tmp_path, layer, slug="row_panel") as (
            page,
            errors,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_selector(
                ".foliplus-layer-item[data-layer-type=overlay]",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            page.mouse.move(5, 400)
            page.evaluate(_js("LayerControl/click_first_overlay_more_btn"))
            page.wait_for_selector(
                ".foliplus-layer-more-menu.open", state="attached", timeout=5000
            )
            page.evaluate(_js("LayerControl/click_layer_attributes"))
            page.wait_for_selector(
                ".foliplus-layer-attrs-panel", state="attached", timeout=5000
            )

            page.mouse.click(900, 450)
            page.wait_for_selector(
                ".foliplus-layer-attrs-panel", state="detached", timeout=5000
            )
            assert self._panel_open(page, ".foliplus-layer-ctrl"), (
                "the press that dismissed the row panel also collapsed the main panel"
            )
            assert not errors, f"JS errors: {errors}"

    def test_row_overlay_stays_visible_over_lit_siblings(self, browser, tmp_path):
        """Sibling rows keep their hover wake while a row overlay is open —
        that is their own state display and the overlay is the pointer's
        destination, not a modal. The guarantee is the overlay staying
        visible: the owner row is lifted to the floating index (the
        overlay's z-index is confined to the owner's stacking context
        whenever the owner is hovered), so no lit sibling can paint over it.
        Probes both the ⋮ menu and the attrs panel: hovering a sibling
        LIGHTS it, and the point at the overlay's center still resolves to
        the overlay itself."""
        layers = [
            folium.FeatureGroup(name=f"Overlay {i}", overlay=True, show=True)
            for i in range(3)
        ]
        with use_page(self._make_page, browser, tmp_path, *layers) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            page.mouse.move(5, 400)  # pointer off the panel

            ROW = ".foliplus-layer-item[data-layer-type=overlay]"

            def row_wake(idx):
                # The Row-cursor wake of a sibling row: glow + drag grip.
                # Nothing may suppress it — it is the row's own state display.
                return page.evaluate(_js("LayerControl/row_wake"), [idx, ROW])

            def overlay_topmost(sel):
                # The point at the overlay's center must resolve to the overlay
                # itself — a lit sibling would otherwise paint over it.
                return page.evaluate(_js("LayerControl/overlay_topmost"), sel)

            def open_more_on_first_row():
                page.evaluate(_js("LayerControl/click_first_row_more_btn"), ROW)
                page.wait_for_selector(
                    ".foliplus-layer-more-menu.open", state="attached", timeout=5000
                )

            # ── ⋮ menu open: a hovering sibling wakes, the menu stays topmost ──
            open_more_on_first_row()
            page.hover(":nth-match(" + ROW + ", 2)")
            page.wait_for_function(
                _js("LayerControl/wait_drag_handle_opacity"),
                arg=[ROW + " .foliplus-drag-cell .drag-handle", 1, "1"],
                timeout=2000,
            )
            assert page.is_visible(".foliplus-layer-more-menu.open")
            wake = row_wake(1)
            assert wake["glow"] is True, (
                "a sibling hover must keep its wake under an open overlay, got "
                + str(wake)
            )
            assert overlay_topmost(".foliplus-layer-more-menu") is True, (
                "the open menu must stay above a lit sibling (owner lifted)"
            )

            # The owner anchor: the menu is the row's descendant, so the row
            # that owns it stays lit while the pointer is on the menu.
            page.hover(".foliplus-layer-more-menu.open li")
            page.wait_for_timeout(250)
            assert page.evaluate(_js("LayerControl/read_owner_row_lit")), (
                "the row owning the open menu must stay lit while hovering it"
            )

            # ── attrs panel open: same contract ──
            # Escape closes the menu without collapsing the panel (a click
            # outside the panel would — bindOutsideCollapse).
            page.keyboard.press("Escape")
            page.wait_for_selector(
                ".foliplus-layer-more-menu.open", state="detached", timeout=5000
            )
            page.mouse.move(5, 400)
            open_more_on_first_row()
            page.evaluate(_js("LayerControl/click_layer_attributes"))
            page.wait_for_selector(
                ".foliplus-layer-attrs-panel", state="attached", timeout=5000
            )
            # The 280px attrs card fully covers the rows below the owner, so
            # the wake probe uses the toggle-all header above it instead.
            SEP = ".foliplus-layer-sep.foliplus-layer-toggle-all"
            page.hover(SEP)
            page.wait_for_function(
                _js("LayerControl/wait_sep_glow"),
                arg=SEP,
                timeout=2000,
            )
            assert overlay_topmost(".foliplus-layer-attrs-panel") is True, (
                "the open attrs panel must stay above a lit sibling"
            )

    # ── zoom-range browser probes ────────────────────────────────────
    #
    # CSS/interaction verification for the zoom-range row: dual-thumb
    # clamp, out-of-range dimming + tooltip, zoomend marker movement,
    # and the native carrier (GridLayer minZoom/maxZoom) measured against
    # a real Leaflet tile container.

    def test_zoom_range_dual_thumb_clamp(self, browser, tmp_path):
        """Two thumbs never cross: dragging min past max clamps min to max."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/zoom_range_dual_thumb_clamp"))
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            assert result["clampForward"], (
                f"min did not clamp to max when dragged past: {result}"
            )
            assert result["clampReverse"], (
                f"max did not clamp to min when dragged below: {result}"
            )
            assert result["stored"] is not None, (
                "zoomRange was not persisted after commit"
            )
            assert not errors, f"JS errors: {errors}"

    def test_zoom_range_oor_dim(self, browser, tmp_path):
        """Out-of-range: row dims, tooltip appears, current label shows."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/zoom_range_oor_dim"))
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            assert result["rowOor"] is True, f"row not marked out-of-range: {result}"
            assert result["rowTitle"], "row tooltip missing when out of range"
            assert result["markerLabelText"], "current-zoom label missing from marker"
            # Out of range is a dim on the whole slider (the library's track
            # stays colored), not a recoloring of the readout the user reads.
            assert result["currentValueColor"] == self._sample_token(
                page, "--foliplus-text-primary"
            ), "out of range must not recolor the current level"
            assert float(result["sliderComputedOpacity"]) < 1, (
                "out of range must dim the slider: " + str(result)
            )
            assert result["limitMinText"], "min limit tick missing"
            assert result["limitMaxText"], "max limit tick missing"
            assert not errors, f"JS errors: {errors}"

    def test_zoom_range_zoomend_marker_moves(self, browser, tmp_path):
        """Current-zoom marker follows the map on zoomend."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/zoom_range_zoomend_marker"))
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            assert result["markerMoved"] is True, (
                f"marker did not move on zoomend: {result}"
            )
            assert result["labelUpdated"] is True, (
                f"current-zoom label did not update on zoomend: {result}"
            )
            assert result["afterInside"] is True, (
                f"current marker missing after zoomend: {result}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_zoom_range_current_label_hidden_at_end(self, browser, tmp_path):
        """The current-value label is hidden when the marker would overlap an end.

        `.foliplus-slider-label-hidden` lives in LayerControl/style.css
        (zoom-range block) because the row is its only consumer. This guards
        that the class still resolves to `visibility: hidden` on the
        current-value span.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/zoom_range_current_label_hidden")
            )
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            # At the map's min zoom the marker sits at 0% of the rail, inside
            # LABEL_MIN_GAP_PCT of the min end, so the label must be hidden.
            assert result["atMin"]["classListHidden"] is True, result["atMin"]
            assert result["atMin"]["visibility"] == "hidden", result["atMin"]
            # In the middle the label is inside the "clear" zone and visible.
            assert result["atMid"]["classListHidden"] is False, result["atMid"]
            assert result["atMid"]["visibility"] == "visible", result["atMid"]
            assert not errors, f"JS errors: {errors}"

    def test_wa_slider_shadow_computed_styles(self, browser, tmp_path):
        """Capture computed styles of wa-slider shadow parts for measurement.

        Writes the results to .foliplus/measurement-report.md so the
        measured values can be compared against the wa.css declarations.

        Three measurement points:
        1. Rest state — all shadow parts (track, thumb, indicator, etc.)
        2. Hover state  — thumb transform + box-shadow after real mouse hover
        3. Active state — thumb transform + box-shadow + cursor after mousedown
        """
        report_dir = Path(__file__).resolve().parents[3] / ".foliplus"
        report_dir.mkdir(exist_ok=True)
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/wa_slider_measurement")
            )
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"

            # ── Hover / Active: static CSS assertion ──
            # Playwright cannot reliably hover shadow-DOM elements inside
            # the style panel (panel dimensions collapse between evaluate
            # calls). We verify the ::part(thumb):hover / :active rules
            # exist in wa.css instead.
            hover_diag = None
            hover_result = None
            active_result = None
            try:
                css_path = (
                    Path(__file__).resolve().parents[3]
                    / "foliplus"
                    / "css"
                    / "common"
                    / "wa.css"
                )
                css_text = css_path.read_text(encoding="utf-8")
                hover_rules = []
                for selector in ("thumb):hover", "thumb):active"):
                    idx = css_text.find(f"::part({selector}")
                    if idx >= 0:
                        # Extract the rule block
                        brace = css_text.find("{", idx)
                        end_brace = css_text.find("}", brace)
                        if brace >= 0 and end_brace >= 0:
                            block = css_text[idx : end_brace + 1]
                            hover_rules.append(block.strip())
                hover_diag = {
                    "cssFile": str(css_path.name),
                    "hoverRulesFound": len(hover_rules),
                    "hoverRules": hover_rules,
                }
            except Exception as e:
                hover_diag = {"error": str(e)}

            # Close the style panel now that all measurements are done
            page.evaluate("""
                () => {
                    const ctrl = window.__layerCtrl;
                    ctrl?.mgr?.ui?.closeStylePanel(false);
                }
            """)

            # ── Build report ──
            lines = ["# wa-slider shadow computed-style measurement\n"]
            for row, key in [("Opacity", "opacity"), ("Zoom-range", "zoom")]:
                prefix = key.lower()
                for part in ("Track", "Thumb", "Thumbs", "Indicator",
                             "Tooltip", "Markers", "HostVars"):
                    k = prefix + part
                    if k in result:
                        lines.append(f"\n## {row} — {part.lower()}\n")
                        lines.append("```json")
                        lines.append(json.dumps(result[k], indent=2))
                        lines.append("```")

            # Hover / Active sections
            if hover_diag:
                lines.append("\n## Opacity — hover/active (static CSS assertion)\n")
                lines.append("```json")
                lines.append(json.dumps(hover_diag, indent=2))
                lines.append("```")
            elif hover_result:
                lines.append("\n## Opacity — thumb active\n")
                lines.append("(null — thumb element not found during mousedown)")

            lines.append("\n## Summary\n")
            ot = result.get("opacityTrack", {})
            zt = result.get("zoomTrack", {})
            lines.append(f"- Opacity track border-width: {ot.get('border-width', '?')}")
            lines.append(f"- Zoom track border-width: {zt.get('border-width', '?')}")
            lines.append(f"- Opacity markers: {len(result.get('opacityMarkers', []))}")
            lines.append(f"- Zoom markers: {len(result.get('zoomMarkers', []))}")
            if hover_diag:
                if "error" in hover_diag:
                    lines.append(f"- Hover CSS check error: {hover_diag['error']}")
                else:
                    lines.append(f"- Hover/active CSS rules found: {hover_diag.get('hoverRulesFound', 0)}")
                    for rule in hover_diag.get("hoverRules", []):
                        lines.append(f"  - {rule[:120]}")

            report_path = report_dir / "measurement-report.md"
            report_path.write_text("\n".join(lines), encoding="utf-8")
            assert not errors, f"JS errors: {errors}"


    def test_zoom_range_native_tilelayer(self, browser, tmp_path):
        """Native carrier: GridLayer minZoom/maxZoom hides tiles on reset."""
        t1 = folium.TileLayer(
            tiles="https://tiles.foliplus.test/{z}/{x}/{y}.png",
            name="NativeProbe",
            attr="Foliplus zoom range probe",
        )
        with use_page(self._make_page, browser, tmp_path, t1, slug="zr_nat") as (
            page,
            errors,
        ):
            page.route(
                "https://tiles.foliplus.test/**",
                lambda route: route.fulfill(
                    status=200,
                    body=base64.b64decode(_tiny_png.split(",", 1)[1]),
                    content_type="image/png",
                ),
            )
            panel_ready(page)
            page.evaluate(_js("LayerControl/set_probe"), {"id": t1.get_name()})
            result = page.evaluate(_js("LayerControl/zoom_range_native_tilelayer"))
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            assert result["before"] > 0, (
                f"no tiles loaded before range was set: {result}"
            )
            # R7's native branch: options write + adapter _resetView.
            # Leaflet does not self-apply options.minZoom changes — the
            # adapter reset is what makes the range visible.
            assert result["tilesCleared"] is True, (
                f"tiles not cleared after options + _resetView with "
                f"out-of-range minZoom: {result}"
            )
            assert result["restoredOk"] is True, (
                f"tiles not restored after deleting options + _resetView: {result}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_zoom_range_zoomend_does_not_add_author_hidden_layer(
        self, browser, tmp_path
    ):
        """Gate 1: a folium ``show=False`` layer stays off the map through a
        zoomend sweep.

        The regression: the sweep's ``applyLayerState({visible: true})``
        unconditionally added a layer the author left off the map, while the
        checkbox stayed unchecked. The one-way gate must leave it alone.
        """
        fg = folium.FeatureGroup(name="ZROffProbe", overlay=True, show=False)
        with use_page(self._make_page, browser, tmp_path, fg, slug="zr_off") as (
            page,
            errors,
        ):
            panel_ready(page)
            # Get the layer's actual id (folium generates one).
            actual_id = page.evaluate(_js("LayerControl/find_zroffprobe_id"))
            if not actual_id:
                raise AssertionError("ZROffProbe layer not found in registry")
            # Re-set probe with the actual id.
            page.evaluate(_js("LayerControl/set_probe"), {"id": actual_id})
            result = page.evaluate(_js("LayerControl/show_false_zoom_stays_off"))
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            # folium 0.14 adds every layer regardless of show=False, so
            # beforeOnMap may be true on that version. The invariant is that
            # the sweep doesn't change the layer's map membership.
            assert result["stateUnchanged"] is True, (
                f"layer map membership changed during zoom sweep: {result}"
            )
            assert result["rowConsistent"] is True, (
                f"row checkbox state drifted during the sweep: {result}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_zoom_range_reload_does_not_add_author_hidden_layer(
        self, browser, tmp_path
    ):
        """Gate 2: a ``show=False`` layer with a stored zoomRange does not
        come back on the map after reload.

        The load path runs ``applyZoomRangeStateOne`` for every layer with
        a stored zoomRange. A stored zoom-range intent alone is not authorization
        to re-add a layer the author left off the map — only ``applyUserState``'s
        unhide branch (a visible override present) is.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Light Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
        ).add_to(m)
        folium.FeatureGroup(name="ZROffReload", overlay=True, show=False).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_zr_off_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # Inject a zoomRange override into localStorage for the show=False
            # layer, simulating a user who previously set a zoom range for it.
            # On reload, applyUserState will restore this entry and run
            # applyZoomRangeStateOne — which must NOT add the layer to the map.
            page.evaluate(_js("LayerControl/seed_zroffreload_storage"))
            # Capture the layer's map membership before reload.
            before = page.evaluate(_js("LayerControl/read_zroffreload_on_map_nullable"))
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # Read the layer's state after reload.
            result = page.evaluate(
                _js("LayerControl/read_zroffreload_on_map_with_error")
            )
            assert result is not None, "evaluation returned None"
            assert result.get("error") is None, f"setup failed: {result}"
            # folium 0.14 adds every layer regardless of show=False, so on
            # that version the layer may be on the map both before and after
            # reload. The invariant is that applyZoomRangeStateOne doesn't
            # ADD a layer the author left off — if folium already placed it,
            # the layer's state simply persists across reload.
            assert result["onMap"] == before, (
                f"layer map membership changed across reload: before={before}, after={result['onMap']}"
            )

    def test_zoom_range_canvas_row_hides_the_heatmap_canvas(self, browser, tmp_path):
        """A canvas-only layer gets a zoom-range row that really hides it.

        HeatmapControl registers through ``createCanvas``, so the range has no
        Leaflet layer to add or remove: its carrier is the canvas HIDDEN class,
        which the executor's ``visible`` op writes. Before 42.1 the row
        was gated off for every canvas surface, because capability alone could
        not tell "has content panes" from "canvas-only" (31.7) and the
        ``!li.canvas`` early return stood in for that distinction.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        fg = folium.FeatureGroup(name="Points", show=True)
        folium.GeoJson(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {"val": i},
                            "geometry": {
                                "type": "Point",
                                "coordinates": [119.30 + i * 0.01, 26.08],
                            },
                        }
                        for i in range(3)
                    ],
                }
            )
        ).add_to(fg)
        fg.add_to(m)
        LayerControl().add_to(m)
        HeatmapControl().add_to(m)
        _expand_panel(m)

        page, errors = make_browser_page(
            browser, tmp_path, m.get_root().render(), "zr_heatmap"
        )
        try:
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            heatmap_ready(page, timeout=15000)
            page.wait_for_timeout(200)

            result = page.evaluate(_js("LayerControl/zoom_range_heatmap_canvas"))
            assert result is not None, "probe returned None"
            assert result.get("error") is None, f"setup failed: {result}"

            # Drawer order: the rows LayerControl adds read before the rows the
            # component delegated, and among themselves they run
            # border -> opacity -> zoom range. No heading marks that split —
            # document order is the whole invariant now.
            assert result["layerBeforeLabel"] is True, (
                f"the Layer rows no longer precede the delegated Label rows: "
                f"{result['struct']}"
            )
            assert result["layerControls"] == ["border", "opacity", "zoomRange"], (
                f"layer rows are not border -> opacity -> zoom range: "
                f"{result['layerControls']} | skeleton: {result['struct']}"
            )

            # An untouched visit writes no zoom-range record at all: neither the
            # value nor a provenance marker.
            assert result["freshZoomRange"] is None, (
                f"an untouched visit stored a zoom range: {result}"
            )
            assert "zoomRange" not in (result["freshOverrides"] or []), (
                f"an untouched visit recorded a zoomRange override: "
                f"{result['freshOverrides']}"
            )

            # The live pass hides and restores through the canvas's own
            # visibility callback.
            assert result["visibleBefore"] is True, f"canvas started hidden: {result}"
            assert result["hiddenOut"] is True, (
                f"the canvas stayed visible out of range: {result}"
            )
            assert result["visibleBack"] is True, (
                f"the canvas stayed hidden after the range came back: {result}"
            )

            # The commit half lands in storage behind the write debounce.
            page.wait_for_timeout(300)
            stored = page.evaluate(
                _js("LayerControl/read_layer_storage_entry"), result["id"]
            )
            assert stored["stored"] == result["committed"], (
                f"the committed range did not reach storage: {stored}"
            )
            assert "zoomRange" in (stored["overrides"] or []), (
                f"the committed range carried no provenance marker: {stored}"
            )
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    # ── Row lookup by data-layer-id, not by registry / DOM position ──
    #
    # Each of these three scrambles the registry or the panel so the two
    # orders disagree, then asserts the mutation landed on the row named by
    # the layer's id. A positional lookup would have hit a neighbor.

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

    def test_updatelayeritemlabel_updates_only_the_id_match_row(
        self, browser, tmp_path
    ):
        """updateLayerItemLabel pushes a rename onto the row named by data-layer-id,
        not the row at the layer's registry index."""
        with use_page(self._make_page, browser, tmp_path, slug="updatelayeritem") as (
            page,
            errors,
        ):
            panel_ready(page)
            state = page.evaluate(_js("LayerControl/updatelayeritem_stale_index"))
            assert state is not None, "LayerControl instance not reachable"
            # The precondition: the row at alpha's registry index is a
            # different layer.
            assert state["alphaRegistryIndex"] != state["alphaDomIndex"]
            assert state["labels"]["alpha"] == "A2", (
                "the renamed layer's row was not updated"
            )
            # Whoever sat at alpha's registry index must keep their own name;
            # an index-based lookup would have written the rename there.
            assert state["labels"]["beta"] == "B", (
                "a neighbor's row was rewritten with alpha's name "
                f"({state['staleIndexWouldHaveHit']!r}) — row resolved by index"
            )
            assert state["labels"]["gamma"] == "C"
            assert not errors, f"JS errors: {errors}"

    def test_focus_closes_map_popup(self, browser, tmp_path):
        """A feature-bound Leaflet popup (folium GeoJsonPopup) closes when
        focusLayer runs — closeOverlays sweeps eachLayer so the popup
        survives on a sublayer-bound surface (not just map._popup) is still
        dropped.

        This is the end-to-end repro of the original bug: click a GeoJson
        feature to open its popup, then focus the layer, and the popup must
        disappear. jsdom/vitest cannot verify this because map is a mock;
        only a real Leaflet map proves the sweep closes the popup.
        """
        fg = folium.FeatureGroup(name="Features", overlay=True, show=True)
        folium.GeoJson(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {"name": "Zone A", "value": 42},
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [
                                    [
                                        [119.29, 26.07],
                                        [119.31, 26.07],
                                        [119.31, 26.09],
                                        [119.29, 26.09],
                                        [119.29, 26.07],
                                    ]
                                ],
                            },
                        }
                    ],
                }
            ),
            name="GeoJson",
            layer_name="GeoJson",
            popup=folium.GeoJsonPopup(
                fields=["name", "value"],
                aliases=["Name", "Value"],
            ),
        ).add_to(fg)

        with use_page(self._make_page, browser, tmp_path, fg, slug="popup_focus") as (
            page,
            errors,
        ):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/popup_closes_on_focus"))
            assert result is not None and "error" not in result, (
                f"popup_closes_on_focus snippet failed: {result}"
            )
            # The popup must have opened on feature click.
            assert result["popupOpenBefore"] is True, (
                f"popup did not open on feature click: {result}"
            )
            # After focus, the popup must be gone.
            assert result["popupStillOpen"] is False, f"popup survived focus: {result}"
            # Focus must be active — proves closeOverlays ran, not a no-op.
            assert result["focusing"] is True, f"focus did not activate: {result}"
            assert not errors, f"JS errors: {errors}"

    def test_focus_hides_native_ui_panes(self, browser, tmp_path):
        """Focus-mode CSS hides Leaflet's own UI panes: marker shadows, hover
        tooltips, and popups.

        The existing hide rule only matches `.foliplus-layer-pane`, so the
        three Leaflet-native floaters all escape focus — a marker's shadow
        keeps painting, a hover tooltip gets *lifted* above the mask by
        `bringFocusedLayerToFront`'s `liftZ("tooltipPane", 3)` call, and a
        popup can open during the focus animation. The three dedicated
        selectors in `focus.css` (`leaflet-shadow-pane`, `leaflet-tooltip-pane`,
        `leaflet-popup-pane`) each `visibility: hidden` under
        `.foliplus-is-focus-mode`; `dismissFocus`'s class removal restores them.
        Companion teardown sweeps `.leaflet-tooltip` alongside `.leaflet-popup`
        so hover residue does not reappear on hover-out after focus ends.

        The probe drives focus by dblclicking the polygon row and samples
        `getComputedStyle(pane).visibility` before, during, and after. The
        tooltip is opened programmatically via `openTooltip()` (hover timing
        is unreliable in headless) and the shadow pane is seeded with a
        synthetic `.leaflet-shadow-image` — folium's default awesome-marker
        icon does not carry a shadow, but the CSS rule is pane-scoped so the
        element inside just has to exist for the assertion to be meaningful.
        """
        # Polygon layer: focus target. Marker layer: produces a tooltip on
        # hover. folium.Marker's default folium.Icon (AwesomeMarkers) does
        # not set a shadow_url, so we do not depend on the shadow pane
        # carrying any element — the CSS rule hides the pane div itself,
        # which is the contract we pin here.
        fg_polygon = folium.FeatureGroup(name="Zones", overlay=True, show=True)
        folium.Polygon(
            locations=[[26.0, 119.2], [26.2, 119.2], [26.2, 119.5], [26.0, 119.5]],
        ).add_to(fg_polygon)
        fg_marker = folium.FeatureGroup(name="Points", overlay=True, show=True)
        folium.Marker([26.05, 119.25], name="P1", tooltip="Tooltip text").add_to(
            fg_marker
        )

        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg_polygon,
            fg_marker,
            slug="focus_native_panes",
        ) as (page, errors):
            panel_ready(page)

            # Expose the test marker to the snippet so it can `openTooltip()`
            # deterministically. The var name is the folium hash suffix.
            marker_var = page.evaluate(_js("LayerControl/find_marker_var"))
            assert marker_var is not None, "could not find the folium marker var"
            page.evaluate(_js("LayerControl/set_test_marker"), marker_var)

            result = page.evaluate(_js("LayerControl/focus_hides_native_panes"))
            assert result is not None and "error" not in result, (
                f"focus_hides_native_panes snippet failed: {result}"
            )

            # Pre-focus: the synthetic shadow image and the opened tooltip are
            # both in the DOM, so the hide assertions below aren't vacuous.
            assert result["before"]["shadowImage"] is True, (
                "shadow pane must carry a .leaflet-shadow-image element before "
                f"focus (else the shadow-pane assertion is vacuous): "
                f"{result['before']}"
            )
            assert result["before"]["tooltipEl"] is True, (
                f"openTooltip() must have produced a .leaflet-tooltip element "
                f"before focus: {result['before']}"
            )
            assert result["before"]["containerFocus"] is False, (
                "focus must not be active before the dblclick"
            )

            # During focus: all three native panes must be `visibility: hidden`.
            assert result["during"]["containerFocus"] is True, (
                f"focus mode did not activate: {result['during']}"
            )
            for name in ("shadowPane", "tooltipPane", "popupPane"):
                pane = result["during"][name]
                assert pane["present"] is True, f"{name} must exist on the map: {pane}"
                assert pane["visibility"] == "hidden", (
                    f"{name} must be `visibility: hidden` during focus "
                    f"— focus.css must hide Leaflet's own UI panes: {pane}"
                )

            # After cancel: the `.foliplus-is-focus-mode` class must be gone,
            # so the CSS rule releases the panes. The tooltip DOM element may
            # have been removed by `closeOverlays`' `.leaflet-tooltip` sweep
            # during focus (intentional — hover residue must not resurrect on
            # hover-out after focus ends), so `after.tooltipEl` is expected to
            # be false; only the container-focus flip is asserted.
            assert result["after"]["containerFocus"] is False, (
                f"focus mode must be released after cancelFocus: {result['after']}"
            )
            # Shadow pane survives (the marker is still on the map; only
            # visibility changed during focus), so its restored visibility is
            # checkable. Tooltip and popup elements may have been swept, so we
            # only assert the visibility value when they survived — either way
            # the assertion does not depend on the sweep outcome.
            assert result["after"]["shadowPane"]["present"] is True, (
                f"shadow pane must survive cancelFocus: {result['after']}"
            )
            assert result["after"]["shadowPane"]["visibility"] == "visible", (
                f"shadow pane must be restored to `visibility: visible` after "
                f"focus is cancelled: {result['after']}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_late_layer_fill_swatch_reads_authored_color(self, browser, tmp_path):
        """#679: bad script order — the control's own script lands before a
        layer's JS global, so the registry entry starts at `layer: null`
        with a pending `kind`. The late-binding hook must rewrite the entry
        when the real object arrives via `layeradd`; otherwise every
        consumer that reads `layerInfo.layer` directly falls back to
        Leaflet's own default `#3388ff` forever. This gate is the raw
        user-visible symptom: the fill swatch must show the author's
        declared `fillColor`, not the fallback.

        `_make_page` puts LayerControl first and the layer second — the
        natural folium render order, so the JS global genuinely lands
        after the control's script. No test-only reordering.
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=[[26.0, 119.2], [26.2, 119.2], [26.2, 119.5], [26.0, 119.5]],
            fill_color="#ffa500",
            fill=True,
        ).add_to(fg)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="late_fill_swatch",
        ) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/late_layer_fill_swatch"))
            assert result is not None and result.get("panel") is True, (
                f"probe did not open the style panel: {result}"
            )
            # The swatch reads the author's declared `fillColor`, not
            # Leaflet's default `#3388ff` (the fallback that used to be
            # sticky when the entry stayed pending).
            assert result["fillValue"].lower() == "#ffa500", (
                f"fill swatch must read the author's declared fillColor, got "
                f"{result['fillValue']!r}: {result}"
            )
            # And no entry is still pending once folium's script has
            # streamed — that is the invariant the fix writes back.
            assert result["unresolved"] == [], (
                f"every layer must be resolved after the script stream, got "
                f"unresolved={result['unresolved']} on row {result.get('id')!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_attribution_only_topmost_visible(self, browser, tmp_path):
        """Regression guard: with multiple base layers checked, the
        attribution control shows exactly one entry — the topmost visible
        base in registry order (list order = z-order).

        Before the fix, foliplus kept a single ``lastAttribution`` cache
        and diffed the new entry against it. When a second base was
        checked under an already-visible first base, Leaflet's own
        ``layeradd`` handler had already added its entry and the
        diff-against-cache early-returned without cleaning the newcomer
        up, so the attribution line stacked every checked base's credit.

        The fix clears the entry table on every sync and rebuilds it from
        a single registry-order scan: the first visible base from
        ``firstBaseIdx`` wins. This is the user's stated semantics —
        "the base furthest forward in the list order shows its attr".

        The snippet walks uncheck A → uncheck B → check B → check A →
        uncheck A so every intermediate state exercises the full rebuild
        through a real browser with Leaflet's attribution control in the
        loop. ``tiles=None`` suppresses folium's default OSM so the test
        focuses on user basemaps; A registers first (index 0, topmost),
        so A's attr wins whenever A is visible, regardless of check order.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="A",
            attr="A attr",
            overlay=False,
            max_zoom=18,
        ).add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="B",
            attr="B attr",
            overlay=False,
            max_zoom=20,
        ).add_to(m)
        _expand_panel(m)
        _write_html(m, tmp_path / "attribution_topmost.html")
        with use_raw_page(browser.new_page) as page:
            page.goto(
                f"file://{tmp_path / 'attribution_topmost.html'}",
                wait_until="domcontentloaded",
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/attribution_only_topmost_visible"))
            assert result is not None and not result.get("error"), result
            steps = result["steps"]
            assert len(steps) == 5, f"expected 5 steps, got {len(steps)}: {result}"
            for step in steps:
                assert step["r"]["ok"] is True, f"toggle failed: {step}"
            # A registers first (index 0 = topmost), so A wins whenever
            # A is visible. The snippet toggles A and B through five
            # intermediate states; each must show exactly the topmost
            # visible base's attr.
            assert result["initial"]["entries"] == {"A attr": 1}, result["initial"]
            # Step 1 (uncheck A): B is now the only visible base.
            assert steps[0]["state"]["entries"] == {"B attr": 1}, steps[0]
            # Step 2 (uncheck B): no user basemap visible.
            assert steps[1]["state"]["entries"] == {}, steps[1]
            # Step 3 (check B): B is visible again.
            assert steps[2]["state"]["entries"] == {"B attr": 1}, steps[2]
            # Step 4 (check A): A is at index 0 (topmost in registry
            # order), so A's attr wins even though A was checked second.
            # This is the regression guard — the old "last-checked wins"
            # rule would have kept B's attr here.
            assert steps[3]["state"]["entries"] == {"A attr": 1}, steps[3]
            # Step 5 (uncheck A): B is now the only visible base.
            assert steps[4]["state"]["entries"] == {"B attr": 1}, steps[4]

    def test_attribution_order_change(self, browser, tmp_path):
        """Regression guard: reordering base layers changes the attribution.

        The user's stated semantics: "adjusting the basemap layer order
        changes the attribution". ``moveLayerUp`` / ``moveLayerDown``
        reorder the registry and call ``enforceOrder`` → ``syncAttribution``,
        so the topmost visible base's attr must follow the reorder.

        A registers first (index 0, topmost), B registers second.
        Initially A's attr wins. After ``moveLayerUp("B")``, B is at
        index 0 and B's attr wins. After ``moveLayerDown("B")``, A is
        back at index 0 and A's attr wins again.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="A",
            attr="A attr",
            overlay=False,
            max_zoom=18,
        ).add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="B",
            attr="B attr",
            overlay=False,
            max_zoom=20,
        ).add_to(m)
        _expand_panel(m)
        _write_html(m, tmp_path / "attribution_order.html")
        with use_raw_page(browser.new_page) as page:
            page.goto(
                f"file://{tmp_path / 'attribution_order.html'}",
                wait_until="domcontentloaded",
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/attribution_order_change"))
            assert result is not None and not result.get("error"), result
            # Initial: A is at index 0 (topmost), so A's attr wins.
            assert result["initial"]["entries"] == {"A attr": 1}, result["initial"]
            # Step 1 (moveLayerUp B): B moves to index 0, B's attr wins.
            assert result["steps"][0]["ok"] is True, result["steps"][0]
            assert result["steps"][0]["state"]["entries"] == {"B attr": 1}, result[
                "steps"
            ][0]
            # Step 2 (moveLayerDown B): B moves back, A's attr wins again.
            assert result["steps"][1]["ok"] is True, result["steps"][1]
            assert result["steps"][1]["state"]["entries"] == {"A attr": 1}, result[
                "steps"
            ][1]

    def test_attribution_sync_no_flicker(self, browser, tmp_path):
        """Flicker guard: reading the attribution table in the same JS
        task as the checkbox click shows exactly one entry — not two.

        Leaflet's ``layeradd`` fires ``addAttribution`` synchronously
        during the click. If ``syncAttribution`` were debounced, the
        table would carry both the pre-existing topmost base's attr and
        the newly-added base's attr for ~50 ms — a visible flicker. The
        synchronous call in ``visibility.ts`` rebuilds the table right
        after the click is processed, before ``debouncedEnforce`` runs.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="A",
            attr="A attr",
            overlay=False,
            max_zoom=18,
        ).add_to(m)
        # B starts hidden: turning it ON is the flicker trigger —
        # Leaflet's synchronous addAttribution fires during the click,
        # and only a synchronous syncAttribution can clear it before the
        # same-JS-task read.
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="B",
            attr="B attr",
            overlay=False,
            max_zoom=20,
            show=False,
        ).add_to(m)
        _expand_panel(m)
        _write_html(m, tmp_path / "attribution_sync.html")
        with use_raw_page(browser.new_page) as page:
            page.goto(
                f"file://{tmp_path / 'attribution_sync.html'}",
                wait_until="domcontentloaded",
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/attribution_sync_no_flicker"))
            assert result is not None and not result.get("error"), result
            # Same-JS-task read after the click: exactly one entry. A
            # debounced syncAttribution would leave Leaflet's synchronous
            # addAttribution("B attr") in the table alongside the
            # pre-existing entry — 2 entries instead of 1.
            assert len(result["entries"]) == 1, result

    def test_hidden_base_does_not_raise_max_zoom(self, browser, tmp_path):
        """A hidden base layer must not raise ``map.getMaxZoom()``.

        foliplus used to write a static union of *all registered*
        layers' native ``options.maxZoom`` into ``map.options.maxZoom``
        on every ``enforceOrder`` pass — including layers the user had
        checked off. Since Leaflet's ``getMaxZoom`` returns
        ``options.maxZoom ?? <max of on-map layers>`,` removing the
        static write lets a hidden base stop raising the ceiling. This
        pins that behavior in a real browser so a future regression
        doesn't quietly come back.
        """
        # Two base layers with distinct native max_zoom values. Both
        # start checked (folium's default for overlay=False). `tiles=None`
        # suppresses folium's own default OSM tile layer, which would
        # otherwise sit on the map outside LayerControl's registry and
        # keep its native 18 in the ceiling regardless of what the user
        # checked off.
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="High",
            attr="High",
            overlay=False,
            max_zoom=20,
        ).add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Low",
            attr="Low",
            overlay=False,
            max_zoom=10,
        ).add_to(m)
        _expand_panel(m)
        _write_html(m, tmp_path / "hidden_base_maxzoom.html")
        with use_raw_page(browser.new_page) as page:
            page.goto(
                f"file://{tmp_path / 'hidden_base_maxzoom.html'}",
                wait_until="domcontentloaded",
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            # Both checked: the ceiling is the union of on-map
            # layers' native max_zoom.
            both = page.evaluate(_js("LayerControl/read_zoom_and_entries"))
            assert both["entries"] == {"High": 1}, both
            assert both["zoom"] == 20, both
            # Uncheck "High" — the ceiling must drop to "Low"'s native
            # 10. Before the fix, "High" was still registered and its
            # native max_zoom would have kept the ceiling at 20.
            page.click("input[aria-label='High']")
            page.wait_for_timeout(300)
            low_only = page.evaluate(_js("LayerControl/read_zoom_and_entries"))
            assert low_only["entries"] == {"Low": 1}, low_only
            assert low_only["zoom"] == 10, (
                f"a hidden base must not raise getMaxZoom, got {low_only['zoom']} "
                "(expected 10 from the visible 'Low' layer's native max_zoom): "
                f"{low_only}"
            )
