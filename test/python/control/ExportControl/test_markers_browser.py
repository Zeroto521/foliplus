"""Marker-paint browser tests for foliplus.ExportControl.

Each case pins a paint channel the export used to drop: a DivIcon's
child-element background, an inline SVG styled by a page class, an
awesome-marker shadow sprite, and the reporting of an image the canvas cannot
read back. They are the marker-side halves of the compositing suite.
"""

from __future__ import annotations

import json

import folium
from conftest import _js, load_geojson, use_page

from .helper import (
    _install_canvas_hook,
    _make_page,
    _run_export,
    _sample_pixels_in_export,
    _wait_export_canvas_ready,
)


class TestExportMarkersBrowser:
    """Browser tests for the marker and shadow paint channels in the export."""

    def test_export_divicon_child_background_color(self, browser, tmp_path):
        """A DivIcon pin drawn by a CHILD element's background-color exports it.

        A DivIcon's root marker element is transparent — no background-image,
        no background-color, no <img>, no <svg>; the visible pin is an
        arbitrary HTML descendant. The remaining-types pass only painted the
        ROOT's background-color, so such a marker exported nothing at all.
        The child's computed background must reach the output canvas, and the
        render must report zero missing assets (a silent skip is the same
        class of defect).
        """
        with use_page(
            _make_page, browser, tmp_path, slug="export_divicon_child_bg"
        ) as (page, errors):
            state = page.evaluate(_js("ExportControl/setup_divicon_child_background"))
            assert state is not None and state.get("marker"), state
            # The premise: the paint lives on a descendant, not the root.
            assert state["childBackground"] == "rgb(0, 204, 102)", state

            _install_canvas_hook(page)
            _run_export(page)
            _wait_export_canvas_ready(page)
            # A DivIcon has no awaited asset on the pin itself; give the
            # pass a settled frame like the other marker pixel tests.
            page.wait_for_timeout(1000)
            result = _sample_pixels_in_export(page, (0, 204, 102), 20, 200)
            assert result is not None, "Export canvas not captured"
            assert result["hit"] > 0, (
                f"DivIcon child background colour missing from the export: {result}"
            )

            stats = page.evaluate(_js("ExportControl/read_render_stats"))
            assert stats is not None, "render stats not exposed on the manager"
            assert stats["failedAssets"] == 0, (
                f"export reported missing assets on a fully local page: {stats}"
            )
            assert not errors, f"JS errors on DivIcon export: {errors}"

    def test_export_divicon_class_styled_svg(self, browser, tmp_path):
        """A DivIcon's inline <svg> keeps its page-CSS fill in the export.

        The export clones the <svg> and serialises it as a standalone image,
        which carries no stylesheet: a fill that comes from a page CSS class
        fell back to the default black fill. The clone must carry the live
        computed styles of the element and its descendants.
        """
        with use_page(
            _make_page, browser, tmp_path, slug="export_divicon_class_svg"
        ) as (page, errors):
            state = page.evaluate(_js("ExportControl/setup_divicon_class_svg"))
            assert state is not None and state.get("marker"), state
            # The premise: the paint is class-derived, not an inline attribute.
            assert state["circleFill"] == "rgb(102, 0, 255)", state

            _install_canvas_hook(page)
            _run_export(page)
            _wait_export_canvas_ready(page)
            # The SVG goes through a blob load inside the pass.
            page.wait_for_timeout(1000)
            result = _sample_pixels_in_export(page, (102, 0, 255), 20, 200)
            assert result is not None, "Export canvas not captured"
            assert result["hit"] > 0, (
                f"DivIcon class-styled SVG fill missing from the export: {result}"
            )
            assert not errors, f"JS errors on class-styled SVG export: {errors}"

    def test_export_awesome_marker_shadow(self, browser, tmp_path):
        """An awesome-marker shadow (DIV + background-image sprite) exports.

        The default Leaflet shadow is an <img> and was drawn by the remaining
        pass. An awesome-marker shadow is a DIV whose paint is a
        background-image sprite, and the shadow channel ran only the
        remaining pass — which never paints sprites — so the shadow was
        silently missing from every exported map that used those markers.
        """
        point = folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "point_11934_2611")),
            name="Awesome Points",
            marker=folium.Marker(
                icon=folium.Icon(color="cadetblue", icon="map-pin", prefix="fa")
            ),
        )
        with use_page(
            _make_page, browser, tmp_path, point, slug="export_awesome_shadow"
        ) as (page, errors):
            page.evaluate(_js("ExportControl/hide_tile_layers"))
            page.wait_for_timeout(500)
            dom = page.evaluate(_js("ExportControl/read_marker_shadow_dom"))
            assert dom is not None and dom["count"] >= 1, (
                f"awesome marker produced no shadow element: {dom}"
            )
            shadow = dom["shadows"][0]
            # The premise: the shadow is a sprite on a DIV, not an <img>.
            assert shadow["tag"] == "DIV", shadow
            assert "url(" in shadow["backgroundImage"], shadow

            _install_canvas_hook(page)
            _run_export(page)
            _wait_export_canvas_ready(page)
            # The shadow sprite loads through the renderer's async fetch.
            page.wait_for_timeout(1500)
            result = page.evaluate(_js("ExportControl/sample_export_shadow_pixels"))
            assert result is not None, "Export canvas not captured"
            assert result["shadow"] > 0, (
                f"marker shadow missing from the export: {result}"
            )
            assert not errors, f"JS errors on awesome-shadow export: {errors}"

    def test_export_reports_broken_asset(self, browser, tmp_path):
        """An image the export cannot read back is counted and reported.

        Asset loads used to be silent: a sprite, icon, or inline-SVG blob
        that failed left a hole in the picture and no signal. The render must
        count it in its stats and print the URL on the console.
        """
        with use_page(_make_page, browser, tmp_path, slug="export_broken_asset") as (
            page,
            errors,
        ):
            console = []
            page.on("console", lambda msg: console.append(msg.text))
            state = page.evaluate(_js("ExportControl/setup_divicon_broken_image"))
            assert state is not None and state.get("marker"), state
            broken_url = state["brokenUrl"]

            _install_canvas_hook(page)
            _run_export(page)
            _wait_export_canvas_ready(page)
            page.wait_for_timeout(1000)
            stats = page.evaluate(_js("ExportControl/read_render_stats"))
            assert stats is not None, "render stats not exposed on the manager"
            assert stats["failedAssets"] >= 1, (
                f"a failed image load was not counted: {stats}"
            )
            reported = [line for line in console if broken_url in line]
            assert reported, (
                f"the failed asset was not reported on the console: {console}"
            )
            assert not errors, f"JS errors on broken-asset export: {errors}"
