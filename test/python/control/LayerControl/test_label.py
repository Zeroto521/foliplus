"""Browser tests for foliplus.LayerControl — annotation & label canvas."""

from __future__ import annotations

import json
import re

import folium
from conftest import (
    _js,
    panel_ready,
    use_page,
)

from foliplus import LayerControl

from ._browser_base import LayerControlBrowserBase


class TestLabelBrowser(LayerControlBrowserBase):
    """Browser-level interaction checks — annotation & label canvas."""

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

    @staticmethod
    def _declared_annotation_layer(
        name, annotation, coords, text="12345678901234567890"
    ):
        """A point layer whose foliplus namespace declares its label defaults."""
        features = [
            {
                "type": "Feature",
                "properties": {"name": text},
                "geometry": {"type": "Point", "coordinates": [lng, lat]},
            }
            for lat, lng in coords
        ]
        return folium.GeoJson(
            json.dumps({"type": "FeatureCollection", "features": features}),
            name=name,
            foliplus={"label": annotation},
        )

    def test_annotation_declared_color_and_size_reach_the_canvas(
        self, browser, tmp_path
    ):
        """A declared color/size paints the real canvas, and Reset restores it.

        Reads the annotation canvas pixels: the declared #00ff00 and size 24
        must be what is actually drawn (not merely what CONF/DOM says), a
        panel-equivalent override must repaint blue, Reset must show the
        declaration again, and a persisted override must survive a reload.
        """
        layer = self._declared_annotation_layer(
            "Declared Style",
            {"field": "name", "color": "#00ff00", "size": 24},
            [(26.08, 119.30)],
        )
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            assert page.evaluate(_js("LayerControl/open_panel")), "panel did not open"
            page.wait_for_selector(
                ".foliplus-layer-item", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/annotation_declared_style"))
            assert result and not result.get("error"), result

            declared = result["declared"]
            cfg = declared["cfg"]
            assert cfg["color"] == "#00ff00", cfg
            assert cfg["size"] == 24, cfg
            assert cfg["show"] is True, cfg
            assert declared["pixels"]["green"] > 100, declared["pixels"]
            bbox = declared["pixels"]["bbox"]
            assert bbox and 12 <= bbox["h"] <= 60, bbox

            overridden = result["overridden"]
            assert overridden["cfg"]["color"] == "#0000ff", overridden["cfg"]
            assert overridden["pixels"]["blue"] > 100, overridden["pixels"]
            assert overridden["pixels"]["green"] == 0, overridden["pixels"]
            stored = [
                key
                for key, raw in result["storage"].items()
                if raw and "#0000ff" in raw
            ]
            assert stored, (
                f"the override did not reach localStorage: {result['storage']}"
            )

            reset = result["afterReset"]
            assert reset["cfg"]["color"] == "#00ff00", reset["cfg"]
            assert reset["cfg"]["size"] == 24, reset["cfg"]
            assert reset["pixels"]["green"] > 100, reset["pixels"]
            assert reset["pixels"]["blue"] == 0, reset["pixels"]

            smaller = result["smaller"]
            assert smaller["cfg"]["size"] == 10, smaller["cfg"]
            assert smaller["pixels"]["green"] < declared["pixels"]["green"] / 1.5, (
                f"size 10 did not shrink the painted label: {smaller['pixels']} vs {declared['pixels']}"
            )

            # Reload: the persisted user override beats the declaration.
            page.reload(wait_until="load")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            assert page.evaluate(_js("LayerControl/open_panel")), "panel did not reopen"
            page.wait_for_selector(
                ".foliplus-layer-item", state="attached", timeout=5000
            )
            page.wait_for_timeout(300)
            after = page.evaluate(_js("LayerControl/annotation_declared_read"))
            assert after and not after.get("error"), after
            assert after["cfg"]["color"] == "#0000ff", after
            assert after["cfg"]["size"] == 24, after
            assert after["blue"] > 0, after
            assert not errors, f"JS errors: {errors}"

    def test_annotation_declared_collide_false_keeps_overlapping_labels(
        self, browser, tmp_path
    ):
        """A declared collide=false keeps both labels; the default hides one."""
        coords = [(26.08, 119.30), (26.08, 119.3076)]
        layer = self._declared_annotation_layer(
            "Declared Collide",
            {"field": "name", "collide": False},
            coords,
        )
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            assert page.evaluate(_js("LayerControl/open_panel")), "panel did not open"
            page.wait_for_selector(
                ".foliplus-layer-item", state="attached", timeout=5000
            )
            result = page.evaluate(
                _js("LayerControl/annotation_declared_collide"),
                [list(c) for c in coords],
            )
            assert result and not result.get("error"), result
            declared = result["declared"]
            assert declared["cfg"]["collide"] is False, declared["cfg"]
            assert declared["labels"] == 2, declared
            assert declared["opaque"] > 0, declared
            collided = result["collided"]
            assert collided["cfg"]["collide"] is True
            # collide=true drops the overlapping label: the same canvas holds
            # visibly fewer pixels (measured 1362 -> 1049, ~1.3x).
            assert declared["opaque"] > collided["opaque"] * 1.15, (
                f"declared collide=false did not keep the second label: {declared} vs {collided}"
            )

            # The style panel's own "Avoid overlap" switch reads the merged
            # config: unchecked while collide is declared false, flipping it
            # writes the user's true, repaints, and persists across a reload.
            toggled = page.evaluate(_js("LayerControl/annotation_collide_toggle"), True)
            assert toggled and not toggled.get("error"), toggled
            assert toggled["declared"]["checked"] is False, toggled["declared"]
            assert toggled["declared"]["cfg"]["collide"] is False, toggled["declared"]
            assert toggled["flipped"]["checked"] is True, toggled["flipped"]
            assert toggled["flipped"]["cfg"]["collide"] is True, toggled["flipped"]
            assert (
                toggled["declared"]["opaque"] > toggled["flipped"]["opaque"] * 1.15
            ), toggled
            assert toggled["stored"] and "collide" in toggled["stored"], (
                f"the toggle change did not persist: {toggled['stored']}"
            )

            page.reload(wait_until="load")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            assert page.evaluate(_js("LayerControl/open_panel")), "panel did not reopen"
            page.wait_for_selector(
                ".foliplus-layer-item", state="attached", timeout=5000
            )
            page.wait_for_timeout(300)
            after = page.evaluate(_js("LayerControl/annotation_collide_toggle"), False)
            assert after and not after.get("error"), after
            assert after["declared"]["checked"] is True, after["declared"]
            assert after["declared"]["cfg"]["collide"] is True, after["declared"]

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
                    f"annotation pane must carry foliplus-label-pane: {result}"
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
            # The label's resident full-name tooltip follows the same write:
            # a hover must not keep announcing the old name.
            assert res["labelTitle"] == "RenamedLayer", (
                f"label title={res['labelTitle']!r}"
            )

    def test_color_basemap_rename_updates_label_title(self, browser, tmp_path):
        """A color-basemap rename repaints text and label title together.

        The basemap row has no registry entry — its rename goes through the
        intent store and updateItemLabel — so the resident full-name tooltip
        must follow the text instead of keeping the locale default.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="Layers", overlay=True, show=True),
            slug="rename_color_label_title",
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_selector(
                '.foliplus-layer-item[data-layer-id="foliplus_color_map"]',
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)
            res = page.evaluate(_js("LayerControl/rename_color_basemap_and_read_label"))
            assert res is not None, "color basemap rename did not commit"
            assert res["label"] == "My Color", res
            assert res["labelTitle"] == "My Color", f"label title={res['labelTitle']!r}"
            assert not errors, f"JS errors: {errors}"

    def _assert_toggle_all_deselect_title(self, title: str | None, label: str) -> None:
        """The toggle-all tooltip says "deselect all" in whatever locale it renders.

        CI is locale-neutral but a local browser can resolve `zh`, so accept the
        translated wording too — the contract is that the tooltip is the
        toggle-all action, never a layer name.
        """
        assert title and ("Deselect" in title or "隐藏" in title), (
            f"Expected {label} 'deselect all' tooltip, got {title!r}"
        )

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
