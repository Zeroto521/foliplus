"""Browser tests for foliplus.LayerControl — label & label canvas."""

from __future__ import annotations

import json
import re

import folium
from conftest import (
    _js,
    leaflet_path,
    leaflet_points,
    load_geojson,
    panel_ready,
    use_page,
)

from foliplus import LayerControl

from ..helper_browser import LayerControlBrowserBase

class TestLabelBrowser(LayerControlBrowserBase):
    """Browser-level interaction checks — label & label canvas."""
    def test_add_label_sets_pane(self, browser, tmp_path):
        """addLabel sets pane on the marker."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/add_label_sets_pane"),
                {"point": leaflet_points("common", "point_1193_2608")[0]},
            )
            assert result is not None
            assert result["pane"] == "__test_label_pane__", f"got {result['pane']}"
            assert result["registered"] is True

    def test_label_click_through(self, browser, tmp_path):
        """The canvas ignores pointer events so clicks land on the map/feature.

        The canvas opts out by carrying ``foliplus-canvas-layer`` (the
        decoration-canvas marker), which the base ``.foliplus-layer-pane``
        rule turns into ``pointer-events: none`` — no inline style. The
        computed value is what we assert, not the inline attribute.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            page.evaluate(
                _js("LayerControl/label_canvas_draws"),
                {"points": load_geojson("common", "points_fuzhou_alpha_beta")},
            )
            result = page.evaluate(_js("LayerControl/label_click_through"))
            assert result is not None and result["canvas"] is True, result
            assert result["pointerEvents"] == "none", result
            assert result["decorationClass"] is True, (
                "label canvas must carry foliplus-canvas-layer"
            )
            assert result["hitIsCanvas"] is False, "label canvas intercepted the click"
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
            result = page.evaluate(
                _js("LayerControl/label_canvas_click_through"),
                {
                    "polygon": leaflet_path("LayerControl", "polygon_fuzhou_viewport"),
                    "marker": [26.1, 119.3],
                    "polyClick": [26.15, 119.35],
                    "markerClick": [26.1, 119.3],
                },
            )
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

    def test_label_stays_put_on_pan(self, browser, tmp_path):
        """Panning must not drift the labels: the canvas cancels mapPane's move."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/label_pan_stable"),
                {"points": load_geojson("common", "points_fuzhou_alpha_beta")},
            )
            assert result is not None and result["canvas"] is True, result
            assert result["beforeLeft"] == result["afterLeft"], result
            assert result["beforeTop"] == result["afterTop"], result
            assert not errors, f"JS errors: {errors}"

    def test_label_labels_follow_layer_visibility(self, browser, tmp_path):
        """Hiding a layer drops its labels; showing it brings them back."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/label_hidden_layer"),
                {"points": load_geojson("common", "points_fuzhou_alpha_beta")},
            )
            assert result is not None, result
            assert result["before"] > 0, result
            assert result["hidden"] == 0, result
            assert result["shown"] > 0, result
            assert not errors, f"JS errors: {errors}"

    def test_label_each_layer_own_pane_ordered_by_layer(self, browser, tmp_path):
        """Each labeled layer gets its own canvas pane, z-ordered with its layer.

        The pane goes through ``PaneManager.ensurePane`` (the single entry
        point for owned panes), so it carries the base ``foliplus-layer-pane``
        class alongside the label role marker — that is what makes the
        pane's interaction rules in focus.css apply without a special case.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/label_multi_layer"),
                {
                    "pointsA": load_geojson("common", "points_fuzhou_alpha_beta"),
                    "pointsB": load_geojson("common", "points_fuzhou_gamma_delta"),
                },
            )
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
            # Both panes carry the base layer class plus the label role.
            for which in ("A", "B"):
                classes = result[f"paneClasses{which}"]
                assert classes is not None, result
                assert classes["layer"] is True, (
                    f"label pane must carry foliplus-layer-pane: {result}"
                )
                assert classes["label"] is True, (
                    f"label pane must carry foliplus-label-pane: {result}"
                )
            assert not errors, f"JS errors: {errors}"

    def test_label_focus_lifts_label_pane(self, browser, tmp_path):
        """Focusing a layer raises its label pane and draws only its labels."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/label_focus_lifts_pane"))
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
