"""Browser test for a label canvas torn down while an export is rendering.

The export renders for seconds (tile pass, shadow pass), and annotation
rendering can be torn down inside that window — a layer unload/re-register
removes every label canvas. The export used to walk past the now-empty label
pane and come back without the labels and without a word; the fix reports it
as one aggregated warning instead.
"""

from __future__ import annotations

from conftest import _js, use_page

from .helper import _install_canvas_hook, _make_page


class TestExportLabelCanvasBrowser:
    def test_label_canvas_lost_mid_export_is_reported(self, browser, tmp_path):
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
            # the render no matter how fast or slow the host is.
            page.evaluate(
                """() => {
                  let armed = false;
                  window.__labelTornDown = false;
                  const tearDown = () => {
                    if (window.__labelTornDown) return;
                    window.__labelTornDown = true;
                    window.__layerCtrl.mgr.annotation.unloadLayer("__export_ann__");
                  };
                  const arm = () => {
                    if (armed) return;
                    armed = true;
                    tearDown();
                  };
                  const OrigImage = window.Image;
                  window.Image = function (...a) {
                    arm();
                    return new OrigImage(...a);
                  };
                  window.Image.prototype = OrigImage.prototype;
                  const origBitmap = window.createImageBitmap;
                  if (origBitmap) {
                    window.createImageBitmap = (...a) => {
                      arm();
                      return origBitmap.apply(window, a);
                    };
                  }
                }"""
            )

            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_function(
                _js("ExportControl/wait_export_collapsed"), timeout=30000
            )
            page.wait_for_timeout(2000)

            assert page.evaluate("() => window.__labelTornDown") is True, (
                "the label teardown never fired inside the render window"
            )
            reported = [
                w
                for w in warnings
                if "label canvas missing" in w and "__export_ann__" in w
            ]
            assert reported, (
                f"a label canvas lost mid-export was not reported; warnings={warnings}"
            )
            assert len(errors) == 0, (
                f"JS errors during a mid-export label teardown: {errors}"
            )
