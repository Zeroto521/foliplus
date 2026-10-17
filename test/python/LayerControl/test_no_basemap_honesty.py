"""No-basemap hatch honesty: guard the paint-observation judgement.

The hatch on the map container is the user-visible signal for "no
basemaps are actually on screen". Its trigger used to read the layer's
*intent* flag plus opacity, and missed the author's declared min/max
zoom: a base outside its own zoom range builds no tile even though
`hasLayer` is still true. Deleting the sole in-range base at that zoom
must paint the hatch, not leave the container as a bare backdrop.

These guards are browser-level because the paint facts (map zoom, layer
`options.minZoom/maxZoom`, map membership) are only observable through
the real UI.
"""

from __future__ import annotations

import re

import folium
import pytest
from conftest import (
    _js,
    make_browser_page,
    use_page,
)

from foliplus import LayerControl

from .helper import _expand_panel, _write_html


def _build_html(tmp_path, name: str, map_max_zoom: int = 18) -> str:
    """Render a map with two disjoint-zoom-range bases + LayerControl.

    The map's own declared max (default 18) must exceed every layer's
    range so a probe can actually zoom past them — Leaflet clamps
    `setZoom` to the map ceiling, which the ordering pass derives from
    the layers' `options.maxZoom` when the author declared none.
    """
    m = folium.Map(
        location=[26.08, 119.30],
        zoom_start=1,
        max_zoom=map_max_zoom,
        tiles=None,
    )
    LayerControl().add_to(m)
    folium.TileLayer(
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        name="Base A",
        attr="© OSM",
        min_zoom=1,
        max_zoom=2,
    ).add_to(m)
    folium.TileLayer(
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        name="Base B",
        attr="© OSM",
        min_zoom=3,
        max_zoom=4,
    ).add_to(m)
    _expand_panel(m)
    html_path = tmp_path / f"{name}.html"
    _write_html(m, html_path)
    return str(html_path)


def _build_html_plain(tmp_path, name: str) -> str:
    """Single base with no declared min/max — for the user-range guard."""
    m = folium.Map(
        location=[26.08, 119.30],
        zoom_start=1,
        max_zoom=18,
        tiles=None,
    )
    LayerControl().add_to(m)
    folium.TileLayer(
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        name="Base A",
        attr="© OSM",
    ).add_to(m)
    _expand_panel(m)
    html_path = tmp_path / f"{name}.html"
    _write_html(m, html_path)
    return str(html_path)


def _load_with_ctrl(browser, tmp_path, html_path: str, name: str):
    """Load the HTML with ``window.__layerCtrl`` exposed for the probe."""
    html = open(html_path, encoding="utf-8").read()
    html, n = re.subn(
        r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
        r"window.__layerCtrl = \1",
        html,
        count=1,
    )
    assert n == 1, "LayerControl instantiation not found in rendered HTML"
    return make_browser_page(browser, tmp_path, html, f"{name}_ctrl")


class TestHatchHonestyBrowser:
    """A base layer only 'paints' if the paint observation says so."""

    def test_delete_only_inrange_base_shows_hatch(self, browser, tmp_path):
        """Deleting the sole in-range base at the current zoom must hatch.

        Before the fix, the judgement read `intentVisibleOf` — B's intent
        flag stayed true after A was deleted, so the hatch never fired
        even though no basemap was on screen (B's declared range [3,4]
        excluded the current zoom of 1, and Leaflet builds no tile for a
        GridLayer outside its min/max).
        """
        html_path = _build_html(tmp_path, "hatch_delete_inrange")
        with use_page(
            _load_with_ctrl, browser, tmp_path, html_path, "hatch_delete_inrange"
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-panel-content[data-ready]",
                state="attached",
                timeout=5000,
            )
            r = page.evaluate(_js("LayerControl/hatch_delete_only_inrange_base"))

        assert r.get("error") is None, f"probe errored: {r}"
        # Both bases declared their ranges: A [1,2] covers zoom 1, B [3,4]
        # does not — so the fixture really is the "sole in-range base" shape.
        assert sorted(b["minZoom"] for b in r["before"]["bases"]) == [1, 3], (
            f"author min/max not on the layers: {r['before']['bases']}"
        )
        assert r["before"]["hatch"] is False, (
            f"A is in range at zoom=1, no hatch expected: {r['before']}"
        )
        assert r["after"]["delReturn"] is True, (
            f"deleteLayer failed: {r['after']}"
        )
        assert r["after"]["hatch"] is True, (
            f"hatch did not appear after deleting the sole in-range base: "
            f"{r['after']}"
        )
        assert not errors, f"JS errors: {errors}"

    def test_zoom_out_of_all_ranges_shows_hatch(self, browser, tmp_path):
        """Zooming past every declared range must turn the hatch on.

        The sweep inside `applyProjectionAll` re-evaluates every layer's
        paint observation on zoom-end, but it never refreshed the hatch
        until this fix. So a zoom that leaves every basemap outside its
        own min/max used to sit with no hatch and no explanation.
        """
        html_path = _build_html(tmp_path, "hatch_zoom_out")
        with use_page(
            _load_with_ctrl, browser, tmp_path, html_path, "hatch_zoom_out"
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-panel-content[data-ready]",
                state="attached",
                timeout=5000,
            )
            r = page.evaluate(_js("LayerControl/hatch_zoom_out_of_all_ranges"))

        assert r.get("error") is None, f"probe errored: {r}"
        # Zoom 1 is inside A's [1,2] → a base paints → no hatch.
        assert r["atInA"]["hatch"] is False, (
            f"hatch on while A is in range: {r['atInA']}"
        )
        # Zoom 5 is above both A's max (2) and B's max (4) → both out.
        assert r["atGap"]["hatch"] is True, (
            f"hatch did not appear after zooming past every declared range: "
            f"{r['atGap']}"
        )
        # Zoom 3 is inside B's [3,4] → hatch off again.
        assert r["atInB"]["hatch"] is False, (
            f"hatch should clear once a base re-enters range: {r['atInB']}"
        )
        # Zoom 4 is still above A's max but inside B's — hatch stays off.
        assert r["atOutHigh"]["hatch"] is False, (
            f"hatch on while B is in range at 4: {r['atOutHigh']}"
        )
        # And back into A's range.
        assert r["atBack"]["hatch"] is False, (
            f"hatch should clear once A re-enters range: {r['atBack']}"
        )
        assert not errors, f"JS errors: {errors}"

    def test_user_zoomrange_shows_hatch(self, browser, tmp_path):
        """A user-set zoom range pulling the base off the map must hatch.

        The style-panel slider writes INTENT.ZOOM_RANGE; the executor
        then removes the layer from the map (effectiveShown false), so
        the paint observation turns false even though the author declared
        no min/max. Distinct path from the author-range guards: the
        trigger is intent-driven map membership, not `options.minZoom`.
        """
        html_path = _build_html_plain(tmp_path, "hatch_user_range")
        with use_page(
            _load_with_ctrl, browser, tmp_path, html_path, "hatch_user_range"
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-panel-content[data-ready]",
                state="attached",
                timeout=5000,
            )
            r = page.evaluate(_js("LayerControl/hatch_user_zoomrange"))

        assert r.get("error") is None, f"probe errored: {r}"
        # The fixture base declares no min/max, so before the intent write
        # it paints at any zoom → no hatch.
        assert r["before"]["hatch"] is False, (
            f"no author range, base should paint at zoom 1: {r['before']}"
        )
        # After the intent write the layer is off the map and the hatch is on.
        assert r["after"]["onMap"] is False, (
            f"layer should have left the map: {r['after']}"
        )
        assert r["after"]["hatch"] is True, (
            f"hatch did not appear after the layer left the map: {r['after']}"
        )
        assert not errors, f"JS errors: {errors}"

    def test_uncheck_sole_base_still_hatches(self, browser, tmp_path):
        """Regression guard: the single-basemap uncheck path still fires.

        Pins the pre-existing behavior so a later refactor that drops
        the trigger leaves the honest empty state visibly broken, not
        just a failing judgement.
        """
        html_path = _build_html(tmp_path, "hatch_uncheck")
        with use_page(
            _load_with_ctrl, browser, tmp_path, html_path, "hatch_uncheck"
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-panel-content[data-ready]",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(200)
            r = page.evaluate(_js("LayerControl/hatch_uncheck_sole_base"))

        assert r.get("error") is None, f"probe errored: {r}"
        assert r["before"]["hatch"] is False, (
            f"expected no hatch on a fresh base-checked state: {r['before']}"
        )
        assert r["after"]["hatch"] is True, (
            f"unchecking every base should show the hatch: {r['after']}"
        )
        assert all(c is False for c in r["after"]["checked"]), (
            f"rows should all be unchecked after the loop: {r['after']}"
        )
        assert not errors, f"JS errors: {errors}"
