"""Browser test: hovering the style panel must NOT light the owner layer row.

The style panel is appended INSIDE its layer row (openStylePanel), so the
pointer over the panel also matches the row's :hover. The Row-cursor recipe
carries a :where(:not(:has(.foliplus-layer-style-panel:hover))) carve-out so a
panel hover returns the owner row to its resting background; hovering the row
itself still lights it (the recipe matches — the carve-out rides only the
:hover branch, so the focused branch is unaffected). jsdom cannot simulate
:hover (the dynamic pseudo-class never matches), so this computed-style probe
runs in the real browser via the CI browser job.

Negative control (kept in this docstring): removing the
:where(:not(:has(.foliplus-layer-style-panel:hover))) carve-out from row.css
makes a panel hover light the owner row, so panel_hover would equal the
row-hover value instead of the rest value — the assertion below would go red.
"""

from __future__ import annotations

import json

import folium
from conftest import _js, make_browser_page, panel_ready, use_page

from foliplus import LayerControl

_ROW = '.foliplus-layer-item[data-layer-type="overlay"]'
_PANEL = ".foliplus-layer-style-panel"
_READ = _js("LayerControl/read_row_hover_carveout")


def _layer() -> folium.GeoJson:
    features = [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [119.28 + i * 0.01, 26.06],
                        [119.32 + i * 0.01, 26.06],
                        [119.32 + i * 0.01, 26.10],
                        [119.28 + i * 0.01, 26.10],
                        [119.28 + i * 0.01, 26.06],
                    ]
                ],
            },
        }
        for i in range(3)
    ]
    return folium.GeoJson(
        json.dumps({"type": "FeatureCollection", "features": features}),
        name="Polygon data",
        show=True,
    )


def _make_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    _layer().add_to(m)
    LayerControl(locale="en").add_to(m)
    return make_browser_page(
        browser, tmp_path, m.get_root().render(), "row_hover_carveout"
    )


def _open_style_panel(page) -> None:
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded",
        state="attached",
        timeout=5000,
    )
    panel_ready(page)
    opened = page.evaluate(_js("LayerControl/open_style_panel"))
    assert opened["ok"], f"style panel did not open: {opened}"
    page.wait_for_selector(_PANEL, state="visible", timeout=5000)


class TestRowHoverCarveoutBrowser:
    """Style-panel hover must not light the owner layer row (computed style)."""

    def test_style_panel_hover_keeps_owner_row_at_rest(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _open_style_panel(page)
            page.wait_for_selector(_ROW, state="attached", timeout=5000)

            # Pointer away: the checked owner row reads its resting wash.
            page.mouse.move(5, 400)
            page.wait_for_timeout(150)
            rest = page.evaluate(_READ)
            assert rest is not None, f"row probe failed: {rest}"
            assert rest["hasPanel"] is True, f"style panel not on the owner row: {rest}"

            # Hover the row itself: the recipe matches (row hover, not panel),
            # so the checked row turns white (surface), not its rest wash.
            page.hover(_ROW + " .foliplus-layer-label")
            page.wait_for_timeout(150)
            row_hover = page.evaluate(_READ)
            assert row_hover["bg"] != rest["bg"], (
                "hovering the row must light it (turn off the wash), got rest "
                + str(rest)
                + " row-hover "
                + str(row_hover)
            )

            # Hover the style panel: the :where(:not(:has(...))) carve-out
            # returns the owner row to its resting wash (no white / glow).
            page.hover(_PANEL)
            page.wait_for_timeout(150)
            panel_hover = page.evaluate(_READ)
            assert panel_hover["bg"] == rest["bg"], (
                "panel hover must keep the owner row at rest, got rest "
                + str(rest)
                + " panel-hover "
                + str(panel_hover)
            )
            assert panel_hover["glow"] == rest["glow"], (
                "panel hover must keep the owner row's rest glow, got rest "
                + str(rest)
                + " panel-hover "
                + str(panel_hover)
            )

            assert not errors, f"JS errors: {errors}"
