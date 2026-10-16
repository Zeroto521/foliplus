"""Compositing tests for foliplus.ExportControl: how the exported PNG reflects what is on the map."""

from __future__ import annotations

import json

import folium
from conftest import _js, panel_ready, use_page

from .helper import (
    _install_canvas_hook,
    _make_page,
    _red_pixels_in_export,
    _run_export,
    _sample_bg_pixels_in_export,
    _solid_tile_layer,
)


class TestExportCompositeBrowser:
    """Browser tests for compositing heatmap / annotation / basemap / hatch into the exported PNG."""

    def test_export_with_heatmap_canvas(browser, tmp_path):
        """Export captures the pixels a canvas layer draws.

        The canvas layer's ``foliplus-canvas-layer`` class marks it as
        pointer-events decoration on screen, but the canvas itself is
        *content* — HeatmapControl is the only user and its map is real data.
        This test draws a red rectangle and checks the export canvas actually
        holds those red pixels. A blanket exclude of ``.foliplus-canvas-layer``
        would silently zero out the count, and the test would catch it.
        """
        with use_page(_make_page, browser, tmp_path, slug="export_heatmap") as (
            page,
            _,
        ):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            created = page.evaluate(_js("ExportControl/create_red_canvas"))
            assert created is True, "create_red_canvas failed"

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
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('foliplus-is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            page.evaluate(_js("ExportControl/remove_test_canvas"))
            result = _red_pixels_in_export(page)
            assert result is not None, "Export canvas not captured"
            assert result["hit"] >= 100, (
                f"Canvas layer's red pixels missing from export: {result}"
            )
            assert result["total"] > 0, f"No pixels drawn in export: {result}"
            assert len(errors) == 0, f"JS errors on canvas export: {errors}"

    def test_export_excludes_self_declared_marked_elements(browser, tmp_path):
        """data-foliplus-export=exclude chrome stays out of the export.

        Traversal-skip contract (data attribute) + hide list (CONTROL, same
        as main) + content must stay exportable:
        - export control bar carries ``data-foliplus-export="exclude"``
          (runtime DOM assert in export_exclude_markers);
        - heatmap / createCanvas canvases are content and must NOT carry
          exclude (``li.canvas`` special path — heatmap must export);
        - a purple marker self-marked ``data-foliplus-export="exclude"`` in a
          foliplus pane does not leak into the export canvas.
        """
        with use_page(_make_page, browser, tmp_path, slug="export_exclude") as (
            page,
            _,
        ):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            markers = page.evaluate(_js("ExportControl/export_exclude_markers"))
            assert markers is not None, "export_exclude_markers returned null"
            assert markers["exportCtrlMarked"] is True, markers
            assert markers["createCanvasUnmarked"] is True, markers

            state = page.evaluate(_js("ExportControl/export_exclude_setup"))
            assert state is not None and "error" not in state, state

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
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('foliplus-is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            page.evaluate(
                f"""() => {{
                    window._probes = {json.dumps([state["wholeCanvasRed"], state["wholeCanvasPurple"]])};
                    window._sampleTol = 40;
                    window._sampleAlphaMin = 100;
                }}"""
            )
            result = page.evaluate(_js("ExportControl/sample_export_window_color"))
            assert result is not None, "Export canvas not captured"

            # Positive control: special-path canvas pixels still appear.
            assert result["pos_canvas_red"]["hit"] > 0, (
                f"Special-path canvas pixels missing from export: {result}"
            )
            # Negative control: marked chrome does not appear anywhere.
            assert result["marked_purple_all"]["hit"] == 0, (
                f"Marked export-exclude element leaked into export: {result}"
            )
            assert len(errors) == 0, f"JS errors on export-exclude export: {errors}"

    def test_export_with_annotation_labels(browser, tmp_path):
        """Export captures the annotation label pixels at their positions.

        The pixel-position comparison is the gate: for every opaque pixel in
        the live annotation canvas, the same (x, y) in the export canvas
        must also be opaque. The two canvases share CSS coordinates (the
        export canvas' crop-box origin cancels the annotation canvas' offset,
        regardless of DPR and export scale), so a pixel-position match is a
        position match. A regression that dropped the annotation canvas from
        the export (a blanket exclude of ``.foliplus-canvas-layer`` would
        do exactly that) would leave zero matched pixels.
        """
        with use_page(_make_page, browser, tmp_path, slug="export_annotation") as (
            page,
            errors,
        ):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            state = page.evaluate(_js("ExportControl/annotation_canvas_in_export"))
            assert state is not None and state["canvas"] is True, state
            assert state["opaqueBefore"] > 0, state
            assert state["sample"] is not None, state

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
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('foliplus-is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            after = page.evaluate(
                """() => {
                    const canvas = window.map
                        .getPane("foliplus-annotation-__export_ann__")
                        ?.querySelector("canvas");
                    if (!canvas) return 0;
                    const data = canvas
                        .getContext("2d")
                        .getImageData(0, 0, canvas.width, canvas.height).data;
                    let n = 0;
                    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
                    return n;
                }"""
            )
            assert after > 0, f"annotation labels lost after export: {after}"

            # Pixel gate: the export canvas now has an opaque background
            # fill (the container's computed backgroundColor), so the source
            # annotation color is blended. Instead of matching the source
            # color, check that the export canvas has non-background pixels —
            # pixels that differ significantly from the gray background. The
            # annotation canvas carries `.foliplus-canvas-layer`; a blanket
            # exclude of that class would drop the labels and leave zero
            # non-background pixels.
            result = page.evaluate(
                """() => {
                    const canvases = window._capturedCanvases || [];
                    if (canvases.length === 0) return { found: false };
                    const c = canvases[canvases.length - 1];
                    const ctx = c.getContext('2d');
                    if (!ctx) return { found: false };
                    const { data } = ctx.getImageData(0, 0, c.width, c.height);
                    // Count pixels that are NOT the background gray (221,221,221)
                    // within tolerance 20. These are the annotation label pixels.
                    let nonBg = 0;
                    for (let i = 0; i < data.length; i += 4) {
                        if (data[i + 3] === 0) continue;
                        const isBg =
                            Math.abs(data[i] - 221) < 20 &&
                            Math.abs(data[i + 1] - 221) < 20 &&
                            Math.abs(data[i + 2] - 221) < 20;
                        if (!isBg) nonBg++;
                    }
                    return { found: true, nonBg };
                }"""
            )
            assert result["found"] is True, result
            assert result["nonBg"] > 0, (
                f"annotation label pixels missing from export: {result}"
            )
            assert len(errors) == 0, f"JS errors on annotation export: {errors}"

    def test_export_uses_solid_color_basemap_as_background(browser, tmp_path):
        """Picking a solid-color basemap → the export canvas is filled with it.

        Before this fix the export background came from ``CONFIG.background`` (a
        Python-static config), so the color the user just picked on screen was
        missing from the image. The export now reads the map container's computed
        ``backgroundColor`` — the same value the user sees — and fills the canvas
        with it.
        """
        with use_page(_make_page, browser, tmp_path, slug="export_color_bg") as (
            page,
            errors,
        ):
            _install_canvas_hook(page)

            # Drive the color input through the real LayerControl UI path so
            # the color pane canvas gets painted with the chosen color,
            # exactly as `showSolidBasemap` does. The color lives on a pane-
            # owned canvas now (not on the container's CSS variable), so the
            # container keeps its default background and the export renderer
            # draws the pane canvas as a layer.
            state = page.evaluate(_js("ExportControl/set_color_basemap"))
            assert state["ok"] is True, state
            assert state["ok"] is True, state
            assert state["colorPaneCount"] > 0, state
            assert state["liVisible"] is True, state

            # Full export flow: open, lock, export.
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
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('foliplus-is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            # Sample the whole canvas for the basemap color. The fillRect
            # covers every pixel, so the hit count should dominate the total.
            result = _sample_bg_pixels_in_export(page, match=[220, 30, 30])
            assert result is not None, "Export canvas not captured"
            assert result["hit"] > 0, f"basemap color missing from export: {result}"
            # The fillRect paints the whole canvas, so nearly every non-
            # transparent pixel should match — a regression (e.g. falling back
            # to CONFIG.background, which was None/transparent) would leave hit ≈ 0.
            assert result["hit"] > result["total"] * 0.5, (
                f"basemap color not dominant in export: {result}"
            )
            assert len(errors) == 0, f"JS errors on color-basemap export: {errors}"

    def test_export_uses_leaflet_default_background_without_color_basemap(
        browser, tmp_path
    ):
        """No solid-color basemap → the export canvas is filled with the map
        container's default background (Leaflet's ``#ddd``).

        The container's computed ``backgroundColor`` is always opaque (Leaflet's
        own CSS sets ``#ddd``), so the export matches what the user sees: a
        plain gray base, not a transparent one. This replaces the old
        ``CONFIG.background`` (default ``None`` → transparent canvas), which
        disagreed with the screen.
        """
        with use_page(_make_page, browser, tmp_path, slug="export_default_bg") as (
            page,
            errors,
        ):
            _install_canvas_hook(page)

            # No color basemap picked: container should be in its default
            # state (Leaflet #ddd, no .foliplus-active, no --color-layer-bg).
            state = page.evaluate(
                """() => {
                    const c = document.querySelector(".leaflet-container");
                    return {
                        bg: getComputedStyle(c).backgroundColor,
                        hasActive: c.classList.contains("foliplus-active"),
                    };
                }"""
            )
            assert state["bg"] == "rgb(221, 221, 221)", state
            assert state["hasActive"] is False, state

            # Full export flow: open, lock, export.
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
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('foliplus-is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            # Sample for Leaflet's default gray. The fillRect paints the whole
            # canvas, so the hit count should dominate.
            result = _sample_bg_pixels_in_export(page, match=[221, 221, 221])
            assert result is not None, "Export canvas not captured"
            assert result["hit"] > 0, f"default gray missing from export: {result}"
            assert result["hit"] > result["total"] * 0.5, (
                f"default gray not dominant in export: {result}"
            )
            assert len(errors) == 0, f"JS errors on default-bg export: {errors}"

    def test_no_basemap_hatch_never_reaches_the_export(browser, tmp_path):
        """Empty-basemap state: the map shows the A' hatch, the export does not.

        With every basemap unchecked the map container turns into an empty
        state (`.foliplus-no-base-map`: transparent background + a `background-image`
        hatch). The hatch is decoration on the screen only — the renderer fills
        from `backgroundColor` and never reads `background-image`, so the
        exported image must be identical to what a no-basemap map without any
        hatch would give.

        Gate on the output, not on the implementation: assert the hatch is
        actually painted on the container (else the test proves nothing), then
        count pixels in the hatch's own alpha band on the export canvas. A real
        vector layer stays in the picture, so a fully empty export cannot hide
        a regression either way.
        """
        marker = folium.CircleMarker(
            location=[26.08, 119.30],
            radius=40,
            color="#00ff00",
            weight=6,
            fill_color="#ff0000",
            fill_opacity=1,
            name="Hatch Marker",
            show=True,
        )
        with use_page(
            _make_page, browser, tmp_path, marker, slug="no_basemap_export"
        ) as (page, errors):
            panel_ready(page)
            _install_canvas_hook(page)

            # Deselect every basemap through the panel's base group toggle-all,
            # so the map enters the empty state the way a user does. The overlay
            # above is not in that group and stays on the map.
            clicked = page.evaluate(_js("LayerControl/uncheck_base_group"))
            state = page.evaluate(_js("ExportControl/no_basemap_state"))
            assert clicked["ok"] is True, clicked
            assert state["ok"] is True, state
            assert state["noBaseMap"] is True, (
                f"container not in no-basemap state: clicked={clicked} state={state}"
            )
            assert state["bg"] != "rgb(0, 0, 0)", (
                f"hatch state must be a light base, got {state['bg']}"
            )
            assert "conic-gradient" in state["bgImage"], (
                f"hatch not painted on the container: {state}"
            )
            # The base group label swaps to the no-basemap variant when every
            # basemap is unchecked (translated from `no_base_map_label`).
            assert state["baseLabelText"] == "No Base Map", (
                f"base group label must swap to the no-basemap variant, "
                f"got {state['baseLabelText']}"
            )

            _run_export(page)

            band = page.evaluate(_js("ExportControl/hatch_alpha_band"))
            assert band is not None, "Export canvas not captured"
            # The overlay kept on the map must still export, so the result is
            # a real image rather than an empty canvas that cannot hide a
            # regression.
            assert band["nonTransparent"] > 1000, f"exported content vanished: {band}"
            # The hatch's own alpha band (0.07 * 255 ~= 18) must be empty: the
            # decoration stayed on screen and never reached the image.
            assert band["band"] == 0, f"hatch pixels leaked into the export: {band}"
            assert len(errors) == 0, f"JS errors on no-basemap export: {errors}"

    def test_export_composites_both_visible_basemaps(browser, tmp_path):
        """Two basemaps both on: the export holds both layers' pixels.

        Basemaps are now first-class and no longer mutually exclusive, and tile
        basemaps paint into their own synthesized pane instead of the shared
        ``leaflet-tile-pane``. Neither change may alter what the renderer
        composites: every visible basemap must still contribute, in order, to
        the exported image. Without this gate "moving a layer to a different
        pane leaves the export untouched" is only covered indirectly.

        The bottom basemap paints at full opacity and the top one at 0.5, so
        the expected pixel is the two layers blended. Sampling that blend —
        rather than either source color — is what proves *both* drew: if the
        upper basemap dropped out the image is the lower color, and if the
        lower one dropped out it is the upper color over transparency.

        The layers are added *after* LayerControl (the ``_make_page``
        convention, matching real user code that writes
        ``LayerControl().add_to(m)`` before its tiles). The renderer resolves
        ``li.layer`` lazily via ``findLayer`` at render time, so a
        construction-time null does not mean a permanent null — the layer is
        found by its id once the folium ``var`` is declared.
        """
        top = _solid_tile_layer((230, 30, 30), "Top Base", opacity=0.5)
        bottom = _solid_tile_layer((30, 60, 220), "Bottom Base", opacity=1.0)

        with use_page(
            _make_page,
            browser,
            tmp_path,
            bottom,
            top,
            slug="two_basemaps_export",
        ) as (page, errors):
            panel_ready(page)
            panel_ready(page)
            _install_canvas_hook(page)

            # Both tile basemaps are visible; the color basemap paints via
            # container background (not a tile layer), so its `visible` flag
            # is not the right gate for "both basemaps drew".
            state = page.evaluate(_js("ExportControl/no_basemap_state"))
            assert state["ok"] is True, state
            assert state["noBaseMap"] is False, f"a basemap should be visible: {state}"
            tile_layers = [
                li for li in state["layers"] if li["id"] != "foliplus_color_map"
            ]
            assert all(li["group"] == "base" and li["visible"] for li in tile_layers), (
                f"both tile basemaps should be visible: {tile_layers}"
            )

            _run_export(page)

            result = _sample_bg_pixels_in_export(page, match=[130, 45, 125])
            dominant = page.evaluate(_js("ExportControl/export_dominant_color"))
            probe = page.evaluate(_js("ExportControl/probe_tile_loading"))
            assert result is not None, "Export canvas not captured"
            assert result["total"] > 0, "Export canvas is empty"
            # The blend dominates: 0.5 * red + 0.5 * blue, so the whole image
            # is one color only if both basemaps painted.
            assert result["hit"] > result["total"] * 0.8, (
                f"blended basemap pixels not dominant: {result} dominant={dominant} probe={probe}"
            )
            assert len(errors) == 0, f"JS errors on two-basemap export: {errors}"

    def test_export_marker_opacity_blend(browser, tmp_path):
        """Marker layer opacity is captured in the export via ancestor-chain alpha.

        R5 moved opacity writes to the pane element; the four DOM rendering
        paths (renderMarkers, renderFontAwesome, renderTextLabels, renderRemaining)
        must read the ancestor-chain alpha via effectiveOpacity(). This test
        creates a marker at 0.4 opacity, exports, captures the renderer's
        internal canvas (via a document.createElement hook), and reads its
        pixels to assert the marker was drawn with alpha ≈ 0.4 × 255 ≈ 102.

        A tight range catches both "forgot to draw" (maxAlpha=0) and
        "forgot to apply alpha" (maxAlpha=255) regressions.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # Set up a marker layer with 0.4 opacity.
            state = page.evaluate(_js("ExportControl/export_opacity_blend"))
            assert state is not None and state["marker"] is True, state
            assert state["paneOpacity"] == "0.4", state
            assert state["paneName"] == "__export_opacity_pane__", state

            # Hook document.createElement to capture the export canvas —
            # the renderer creates it internally and never attaches it to the DOM.
            # The patch is not restored: use_page gives each test a fresh page,
            # so the interception cannot leak between tests.
            page.evaluate(
                """() => {
                    window._capturedCanvases = [];
                    const orig = document.createElement.bind(document);
                    document.createElement = function(tag, ...args) {
                        const el = orig(tag, ...args);
                        if (tag === 'canvas') {
                            window._capturedCanvases.push(el);
                        }
                        return el;
                    };
                }"""
            )

            # Full export flow: open, lock, export.
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
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('foliplus-is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            # Read the captured canvas pixels and verify the marker was
            # drawn. The export canvas now has an opaque background fill, so
            # the marker's alpha composites onto the background — the
            # resulting pixel alpha is 255 (from the background), and the
            # opacity is reflected in the color blend rather than in alpha.
            #
            # The background is Leaflet's default gray (221, 221, 221). The
            # marker is a red pin; even at 0.4 opacity the blended pixel is
            # visibly different from gray. Count pixels that differ from the
            # background by more than tolerance 30 in any channel — this
            # catches "marker drawn at any opacity" and "marker not drawn
            # at all" (all pixels would be gray).
            result = page.evaluate(
                """() => {
                    const canvases = window._capturedCanvases || [];
                    if (canvases.length === 0) return { found: false };
                    const c = canvases.reduce(
                        (best, cv) =>
                            cv.width * cv.height > best.width * best.height ? cv : best,
                        canvases[0],
                    );
                    const ctx = c.getContext('2d');
                    if (!ctx) return { found: false };
                    const data = ctx.getImageData(0, 0, c.width, c.height).data;
                    let nonBg = 0;
                    let sample = null;
                    for (let i = 0; i < data.length; i += 4) {
                        if (data[i + 3] === 0) continue;
                        const isBg =
                            Math.abs(data[i] - 221) <= 30 &&
                            Math.abs(data[i + 1] - 221) <= 30 &&
                            Math.abs(data[i + 2] - 221) <= 30;
                        if (!isBg) {
                            nonBg++;
                            if (!sample) sample = [data[i], data[i + 1], data[i + 2]];
                        }
                    }
                    return { found: true, nonBg, sample };
                }"""
            )
            assert result["found"] is True, result
            assert result["nonBg"] > 0, f"Marker pixels missing from export: {result}"
