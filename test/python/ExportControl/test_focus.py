"""Focus/visibility behavior tests for foliplus.ExportControl."""

from __future__ import annotations

from conftest import _js, use_page

from foliplus import MeasureControl

from .helper import _install_canvas_hook, _make_page


class TestExportFocusBrowser:
    """Browser tests for locked_follow / focus carriers / visibility behavior in the exported PNG."""

    def test_locked_box_follows_zoom(self, browser, tmp_path):
        """Locked crop box follows the map after zoom."""
        with use_page(_make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            # Lock the box
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.foliplus-locked", state="attached", timeout=5000
            )

            # Zoom in — the locked box should keep tracking the same geo area
            page.keyboard.press("Control+=")
            page.wait_for_timeout(1000)

            # Box should still be visible and locked
            assert page.locator(".foliplus-export-box.foliplus-locked").is_visible()
            after_zoom = page.evaluate(_js("ExportControl/read_box_rect"))
            assert after_zoom["w"] > 0 and after_zoom["h"] > 0, (
                f"Box disappeared after zoom, size={after_zoom}"
            )

    def test_drag_crop_box_no_jump(self, browser, tmp_path):
        """Dragging the crop box center must move it continuously, without a
        single frame that jumps the box past the natural frame-to-frame delta.

        Regression for "crop-box jumps mid-drag": a jump is a symptom of
        accumulated movement being applied on release, or a mid-drag re-read
        of the wrong rect (usually a stale closure) that snaps the box
        forward.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            start = page.evaluate(_js("ExportControl/read_box_center"))
            assert not start.get("error"), f"setup failed: {start}"

            sample_promise = page.evaluate_handle(
                _js("ExportControl/sample_box_drag_frames")
            )

            cx = start["centerX"]
            cy = start["centerY"]
            page.mouse.move(cx, cy)
            page.mouse.down()
            page.mouse.move(cx + 120, cy, steps=20)
            page.mouse.up()
            page.wait_for_timeout(200)

            result = sample_promise.json_value()
            samples = result["samples"]
            assert not errors, f"JS errors: {errors}"
            assert samples, "no samples collected"

            # Compute per-frame delta. A single step is 120 / 20 = 6 px, so a
            # legitimate step-to-step delta should be at most ~2x that (6 px /
            # frame × 2 = 12 px for jitter). A spike is a frame where the box
            # moved by 3× the per-step delta in one frame -- the "jump".
            deltas = []
            for i in range(1, len(samples)):
                d = abs(samples[i]["l"] - samples[i - 1]["l"])
                deltas.append(d)
            per_step = 120 / 20  # 6 px
            spikes = [d for d in deltas if d > per_step * 3]
            assert not spikes, (
                f"crop box jumped during drag -- a frame moved by {max(spikes):.1f}px "
                f"when the per-step target was {per_step}px. All deltas: {deltas}"
            )

    def test_locked_box_drag_out_stays_out_after_confirm(self, browser, tmp_path):
        """Dragging the crop box partially outside the viewport, then pressing
        confirm, must not snap the box back inside.

        Regression for "crop box snaps back on confirm after being dragged
        out of view": confirm previously
        read the saved viewport bounds instead of the box's own geo bounds, so
        a box that was dragged off the visible edge snapped back onto the map
        the moment it was locked.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            before = page.evaluate(_js("ExportControl/read_box_rect"))
            assert before["w"] > 0 and before["h"] > 0, f"no box: {before}"

            # Drag the box center 400 px down + 200 px right -- past the
            # viewport on a normal 1280×800 viewport.
            center = page.locator(".foliplus-export-center")
            center_box = center.bounding_box()
            cx = center_box["x"] + center_box["width"] / 2
            cy = center_box["y"] + center_box["height"] / 2
            page.mouse.move(cx, cy)
            page.mouse.down()
            page.mouse.move(cx + 200, cy + 400, steps=10)
            page.mouse.up()
            page.wait_for_timeout(300)
            after_drag = page.evaluate(_js("ExportControl/read_box_rect"))
            # The box moved to where we dragged it.
            assert after_drag["l"] > before["l"] or after_drag["t"] > before["t"], (
                f"box did not move on drag: {before} -> {after_drag}"
            )

            # Confirm. The box's geo bounds must be preserved -- no snap back.
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.foliplus-locked",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)
            after_confirm = page.evaluate(_js("ExportControl/read_box_rect"))
            assert not errors, f"JS errors: {errors}"
            # The left edge should not have moved back past its dragged position
            # (allow 1 px of rounding).
            assert after_confirm["l"] >= after_drag["l"] - 1, (
                f"confirm snapped the box back toward the viewport: "
                f"dragged to {after_drag['l']}, after confirm {after_confirm['l']}"
            )

    def test_export_focus_three_carriers_survive(self, browser, tmp_path):
        """Focus state: all three carriers (vector, marker, canvas) survive export.

        Focus mode hides non-focused layer panes with CSS `visibility: hidden`.
        SVG vectors inherit this visibility and disappear from the export.
        Markers (not in foliplus panes) and canvas (renderPaneCanvas doesn't
        check visibility) survive regardless.

        B1 peels the pane's inline visibility before reading computed styles,
        so all three carriers survive. Before B1, vectors ≈ 0; after, all > 0.

        Three non-overlapping windows: left (GeoJson vector), center (marker),
        right (heatmap canvas). Focusing the canvas layer hides the vector pane.
        """
        with use_page(_make_page, browser, tmp_path, slug="export_focus") as (
            page,
            _,
        ):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # Set up three carriers and activate focus on the canvas layer.
            state = page.evaluate(_js("ExportControl/focus_three_carriers"))
            assert state is not None and "error" not in state, state
            assert state["focusLayer"] == "__focus_canvas__", state

            # Install canvas hook before export.
            _install_canvas_hook(page)

            # Full export flow.
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.foliplus-locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_function(
                _js("ExportControl/wait_export_collapsed"), timeout=30000
            )
            page.wait_for_timeout(2000)

            # Sample three windows in the export canvas.
            page.evaluate(
                _js("ExportControl/set_sample_window_params"),
                {
                    "windows": state["windows"],
                    "color": [230, 30, 30],
                    "tol": 30,
                    "alphaMin": 100,
                },
            )
            result = page.evaluate(_js("ExportControl/sample_export_window"))
            assert result is not None, "Export canvas not captured"

            # All three carriers must survive: each window has red pixels.
            for carrier in ("vector", "marker", "canvas"):
                w = result[carrier]
                assert w["total"] > 0, (
                    f"{carrier} carrier has no pixels in export: {result}"
                )
                assert w["hit"] > 0, (
                    f"{carrier} carrier red pixels missing from export: {result}"
                )
                ratio = w["hit"] / w["total"]
                assert 0.95 <= ratio <= 1.05, (
                    f"{carrier} survival ratio {ratio:.3f} outside [0.95, 1.05]: {result}"
                )

            assert len(errors) == 0, f"JS errors on focus export: {errors}"

    def test_export_focus_element_display_none(self, browser, tmp_path):
        """Reverse gate: element's own display:none is respected in export.

        Sets display:none on a specific SVG path (blue polygon), exports, and
        asserts the path's window has 0 blue pixels. The polygon is blue so
        its pixels are distinguishable from the red background — the pruning
        code in renderPaneSVG removes display:none elements from the clone,
        so they never appear in the SVG string and produce zero pixels.
        """
        with use_page(_make_page, browser, tmp_path, slug="export_display_none") as (
            page,
            _,
        ):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # Set up carriers with a blue polygon (distinguishable from
            # the red background).
            state = page.evaluate(_js("ExportControl/setup_display_none_test"))
            assert state is not None and "error" not in state, state

            # Hide the polygon's SVG path via display:none.
            hide_result = page.evaluate(_js("ExportControl/hide_blue_path"))
            assert hide_result is not None and hide_result.get("hidden") is True, (
                f"Could not find/hide blue vector path: {hide_result}"
            )

            # Install canvas hook before export.
            _install_canvas_hook(page)

            # Full export flow.
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.foliplus-locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_function(
                _js("ExportControl/wait_export_collapsed"), timeout=30000
            )
            page.wait_for_timeout(2000)

            # Sample the vector window — should have 0 blue pixels (path pruned).
            page.evaluate(
                _js("ExportControl/set_sample_window_params"),
                {
                    "windows": state["windows"],
                    "color": [0, 0, 230],
                    "tol": 30,
                    "alphaMin": 100,
                },
            )
            result = page.evaluate(_js("ExportControl/sample_export_window"))
            assert result is not None, "Export canvas not captured"

            assert result["vector"]["hit"] == 0, (
                f"Hidden path (display:none) still has blue pixels in export: {result}"
            )
            # Also verify the other two carriers are still present.
            page.evaluate(
                _js("ExportControl/set_sample_color"),
                {"color": [230, 30, 30]},
            )
            result2 = page.evaluate(_js("ExportControl/sample_export_window"))
            assert result2["marker"]["hit"] > 0, f"Marker carrier missing: {result2}"
            assert result2["canvas"]["hit"] > 0, f"Canvas carrier missing: {result2}"

            assert len(errors) == 0, f"JS errors on display:none export: {errors}"

    def test_export_visibility_hidden_behavior(self, browser, tmp_path):
        """Empirical test: does the export draw visibility:hidden elements?

        Sets visibility:hidden on a blue polygon's SVG path, exports, and
        checks if blue pixels are present. The contract intends
        for visibility (not display) to be used for layout preservation while
        export still sees the element. This test provides empirical evidence
        for the reviewer's contract update decision.
        """
        with use_page(
            _make_page, browser, tmp_path, slug="export_visibility_hidden"
        ) as (page, _):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # Set up carriers with a blue polygon.
            state = page.evaluate(_js("ExportControl/setup_display_none_test"))
            assert state is not None and "error" not in state, state

            # Set visibility:hidden on the polygon's SVG path.
            hide_result = page.evaluate(_js("ExportControl/hide_blue_path_visibility"))
            assert hide_result is not None and hide_result.get("hidden") is True, (
                f"Could not find/hide blue vector path: {hide_result}"
            )

            # Install canvas hook before export.
            _install_canvas_hook(page)

            # Full export flow.
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.foliplus-locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_function(
                _js("ExportControl/wait_export_collapsed"), timeout=30000
            )
            page.wait_for_timeout(2000)

            # Sample the vector window for blue pixels.
            page.evaluate(
                _js("ExportControl/set_sample_window_params"),
                {
                    "windows": state["windows"],
                    "color": [0, 0, 230],
                    "tol": 30,
                    "alphaMin": 100,
                },
            )
            result = page.evaluate(_js("ExportControl/sample_export_window"))
            assert result is not None, "Export canvas not captured"

            # Report the empirical result.
            print(f"visibility:hidden empirical result: {result}")
            print(f"Vector window blue pixel hit count: {result['vector']['hit']}")

            assert len(errors) == 0, f"JS errors on visibility:hidden export: {errors}"

    def test_export_preview_excluded_finalized_retained(self, browser, tmp_path):
        """Preview lines are excluded from export; finalized lines are retained.

        SKIP_EXPORT stamps the `.foliplus-skip-export` class on preview elements (addPreview).
        The renderer's clone pruning removes them from the export. The finalized
        line (in mainLayer) has no such marking and must survive.

        Two non-overlapping windows: left (finalized), right (preview). In
        drawing state, left > 0, right == 0. A regression that marks finalized
        as SKIP_EXPORT would zero out left; one that doesn't mark preview would
        leave right > 0.
        """
        with use_page(
            _make_page,
            browser,
            tmp_path,
            MeasureControl(),
            slug="export_preview",
        ) as (page, _):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # Expose __measureManager (not injected by _make_page).
            debug = page.evaluate(_js("ExportControl/check_measure_manager"))
            assert debug["hasCtrl"] is True, f"__measureCtrl not set: {debug}"
            assert debug["hasManager"] is True, f"__measureManager not set: {debug}"

            # Set up finalized line + preview line.
            state = page.evaluate(_js("ExportControl/setup_preview_finalized"))
            assert state is not None and "error" not in state, state
            assert state["finalized"] is True, state
            assert state["preview"] is True, state

            # Install canvas hook before export.
            _install_canvas_hook(page)

            # Cancel measuring mode so ExportControl is not blocked.
            page.evaluate(_js("ExportControl/clear_measure_mode"))

            # Full export flow.
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.foliplus-locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_function(
                _js("ExportControl/wait_export_collapsed"), timeout=30000
            )
            page.wait_for_timeout(2000)

            # Sample both windows.
            page.evaluate(
                _js("ExportControl/set_sample_window_params"),
                {
                    "windows": state["windows"],
                    "color": [230, 30, 30],
                    "tol": 30,
                    "alphaMin": 100,
                },
            )
            result = page.evaluate(_js("ExportControl/sample_export_window"))
            assert result is not None, "Export canvas not captured"

            # Debug: check canvas state.
            debug2 = page.evaluate(_js("ExportControl/debug_export_canvas"))
            print(f"[debug] canvas state: {debug2}")

            # Finalized line must be in the export.
            assert result["left"]["hit"] > 0, (
                f"Finalized line missing from export: {result}"
            )
            # Preview line must NOT be in the export.
            assert result["right"]["hit"] == 0, (
                f"Preview line leaked into export: {result}"
            )

            assert len(errors) == 0, f"JS errors on preview export: {errors}"

    def test_export_no_preview_finalized_retained(self, browser, tmp_path):
        """Reverse gate: finalized line survives when not in drawing state.

        Without a preview, the SKIP_EXPORT pruning has nothing to remove. The
        finalized line must still be in the export. This prevents a regression
        that accidentally marks finalized elements as SKIP_EXPORT (which would
        only be visible when a preview is absent).
        """
        with use_page(
            _make_page,
            browser,
            tmp_path,
            MeasureControl(),
            slug="export_no_preview",
        ) as (page, _):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # Expose __measureManager (not injected by _make_page).
            debug = page.evaluate(_js("ExportControl/check_measure_manager"))
            assert debug["hasCtrl"] is True, f"__measureCtrl not set: {debug}"
            assert debug["hasManager"] is True, f"__measureManager not set: {debug}"

            # Set up only a finalized line (no preview).
            state = page.evaluate(_js("ExportControl/setup_finalized_only"))
            assert state is not None and "error" not in state, state
            assert state["finalized"] is True, state
            assert state["preview"] is False, state

            _install_canvas_hook(page)

            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.foliplus-locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_function(
                _js("ExportControl/wait_export_collapsed"), timeout=30000
            )
            page.wait_for_timeout(2000)

            page.evaluate(
                _js("ExportControl/set_sample_window_params"),
                {
                    "windows": state["windows"],
                    "color": [230, 30, 30],
                    "tol": 30,
                    "alphaMin": 100,
                },
            )
            result = page.evaluate(_js("ExportControl/sample_export_window"))
            assert result is not None, "Export canvas not captured"
            assert result["left"]["hit"] > 0, (
                f"Finalized line missing from export (no preview): {result}"
            )

            assert len(errors) == 0, f"JS errors on no-preview export: {errors}"
