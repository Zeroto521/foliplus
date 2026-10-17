"""Circle-mode tests for foliplus.MeasureControl."""

from __future__ import annotations

from conftest import _js, use_page

from .helper import _make_page


class TestMeasureCircleBrowser:
    def test_circle_del_icon_removes_circle(self, browser, tmp_path):
        """Clicking the delete X in circle mode removes the entire circle."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/draw_circle"))
            page.wait_for_timeout(500)
            # Fire the delMkr click with a mock originalEvent targeting the X icon
            page.evaluate(_js("MeasureControl/delete_measurement_del_icon"))
            page.wait_for_timeout(300)
            hasDelMkr = page.evaluate(_js("MeasureControl/has_delete_marker"))
            assert not hasDelMkr, "delMkr should be removed after clicking delete"
            assert not errors, f"JS errors: {errors}"

    def test_circle_preview_node_follows_mouse(self, browser, tmp_path):
        """Regression: the circle preview node must follow the mouse while drawing.

        Previously the node was only positioned at creation and stayed pinned
        at that spot on the map during the preview.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(
                _js("MeasureControl/draw_circle_preview_follows_mouse")
            )
            assert state["x1"] is not None, "preview node not rendered"
            assert state["x2"] is not None
            moved = (state["x1"], state["y1"]) != (state["x2"], state["y2"])
            assert moved, f"circle preview node did not follow the mouse: {state}"
            s = state["stack"]
            # 3-pane layout: nodes live in the node pane, geometry in the
            # graph pane. Paint order is guaranteed by pane z-index, not
            # SVG sibling order.
            assert s["nodePane"] == "node", f"radius node not in node pane: {s}"
            assert s["centerPane"] == "node", f"center node not in node pane: {s}"
            assert s["node"] > s["circle"], f"node pane z below graph pane: {s}"
            assert s["center"] > s["circle"], (
                f"node pane z below graph pane (center): {s}"
            )
            # After a third move the pane z-index ordering must hold.
            s3 = state["stackAfterThirdMove"]
            assert s3["node"] > s3["circle"], (
                f"node pane z dropped below graph after repeated moves: {s3}"
            )
            assert s3["center"] > s3["circle"], (
                f"center pane z dropped below graph after repeated moves: {s3}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_circle_preview_label_in_label_pane(self, browser, tmp_path):
        """The circle preview radius label must land in the label pane.

        `PreviewMode.addPreview` used to forward no pane name, so the label
        silently defaulted to the graph pane alongside the circle fill, the
        radius line and both nodes. There the label competes for SVG paint
        order with the geometry, so at a short radius the dots cover it.
        Distance and polygon always routed their preview labels through
        CONST.PANES.LABEL, which is why only circle mode showed this.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.wait_for_timeout(300)
            state = page.evaluate(_js("MeasureControl/circle_preview_label_pane"))
            panes = {p["name"]: int(p["z"]) for p in state["allPanes"]}
            # 3-pane layout: graph (k=0), node (k=1), label (k=2)
            assert panes.get("graph") == 600, f"graph pane z wrong: {state}"
            assert panes.get("label") == 602, (
                f"label pane z wrong (expected graph+2): {state}"
            )
            for phase in ("near", "far"):
                assert "foliplus-measure-label-pane" in state[phase]["pane"], (
                    f"circle preview label is in {state[phase]['pane']} at {phase} radius"
                )
                assert int(state[phase]["z"]) == panes["label"], (
                    f"label pane z={state[phase]['z']} not {panes['label']}"
                )
            assert not errors, f"JS errors: {errors}"

    def test_circle_preview_label_reattached_every_frame(self, browser, tmp_path):
        """While the circle preview is live the radius label chip stays the
        last marker child of the label pane.

        The label was moved in place with `setLatLng`, which keeps the sibling
        position from creation time. Once a finalized circle's label had
        entered the pane after the preview started, the preview chip stayed
        ahead of it and was painted under — the moving preview label visually
        disappeared below the earlier measurement's label.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(
                _js("MeasureControl/circle_preview_label_reattached")
            )
            # The planted chip plus the preview chip should both be present.
            assert state["frames"], "no preview frames captured"
            assert all(f["total"] == 2 for f in state["frames"]), (
                f"expected planted + preview label: {state['frames']}"
            )
            assert state["alwaysLast"], (
                f"preview label was not the last label-pane child on every frame: {state['frames']}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_restore_circle_from_storage(self, browser, tmp_path):
        """restoreCircle restores a circle measurement from localStorage without ReferenceError."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/seed_circle_storage"))
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate(_js("MeasureControl/read_measurements_length"))
            assert count == 1, f"expected 1 restored circle, got {count}"
            registered = page.evaluate(_js("MeasureControl/read_layers_registered"))
            assert registered, "Layer should be registered after restoring circle"
            assert not errors, f"JS errors: {errors}"
