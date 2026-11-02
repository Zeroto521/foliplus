"""Browser test for a label canvas torn down while an export is rendering.

The export renders for seconds (tile pass, shadow pass), and annotation
rendering can be torn down inside that window — a layer unload/re-register
removes every label canvas. The export used to walk past the now-empty label
pane, read the live canvas at pass time, and come back without the labels and
without a word.

The task-22 fix freezes each layer's label canvas pixels synchronously at
render() start — before the first await. A teardown inside the render window
therefore cannot blank the labels: the export draws the frozen pixels the user
saw when they pressed Export. This test arms the same teardown hook and asserts
the labels are still in the export (they would be absent on the old code).
"""

from __future__ import annotations

from conftest import _js, use_page

from .helper import _install_canvas_hook, _make_page


class TestExportLabelCanvasBrowser:
    def test_label_canvas_survives_mid_export_teardown(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path, slug="export_label_loss") as (
            page,
            _,
        ):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            warnings = []
            page.on(
                "console",
                lambda m: warnings.append(m.text) if m.type == "warning" else None,
            )

            state = page.evaluate(_js("ExportControl/annotation_canvas_in_export"))
            assert state is not None and state["canvas"] is True, state
            assert state["opaqueBefore"] > 0, state

            _install_canvas_hook(page)

            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.foliplus-locked", state="attached", timeout=5000
            )

            # Tear the annotation rendering down inside the render window: the
            # layer stays on the map, its label canvas does not. The trigger is
            # the first tile image the export loads, so the teardown lands in
            # the render no matter how fast or slow the host is. The task-22
            # snapshot ran before the teardown, so the export still draws the
            # labels the user saw — this is the assertion that used to fail
            # silently on the live-canvas read.
            page.evaluate(_js("ExportControl/arm_label_teardown"))

            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_function(
                _js("ExportControl/wait_export_collapsed"), timeout=30000
            )
            page.wait_for_timeout(2000)

            assert page.evaluate(_js("ExportControl/read_label_teardown")) is True, (
                "the label teardown never fired inside the render window"
            )

            # The frozen snapshot carried the labels: the export must still
            # contain non-background (label) pixels even though the live canvas
            # was torn down mid-render.
            result = page.evaluate(_js("ExportControl/annotation_nonbg_pixel_count"))
            assert result["found"] is True, result
            assert result["nonBg"] > 0, (
                f"labels lost from export despite the task-22 snapshot: {result}; "
                f"warnings={warnings}"
            )

            # Nothing was lost, so the aggregated warning must not fire.
            reported = [
                w
                for w in warnings
                if "label canvas missing" in w and "__export_ann__" in w
            ]
            assert not reported, (
                f"a label canvas that the snapshot preserved was reported lost; "
                f"warnings={warnings}"
            )
            assert len(errors) == 0, (
                f"JS errors during a mid-export label teardown: {errors}"
            )
