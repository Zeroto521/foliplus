"""Browser test: a declared fill ramp reaches the map and the panel at load.

`foliplus={"fill": {...}}` is the author's fill declaration. The map must open
painted by value (not on the author's flat color), the style row must show the
declared field / method / classes / scheme, and Reset must return to that
declaration — the same "Reset returns to the author's declaration" contract the
label declaration has. A later panel edit is the user's intent and must survive
a reload.

The probes are the shared fill-row readers the per-feature author test uses:
one reads the row and the painted `fill` attributes, the other drives the panel
(open / pick a scheme / Reset). Nothing here depends on geopandas: the fixture
builds the GeoJson with folium directly, so the assertion covers the JS path.
"""

from __future__ import annotations

import json

import folium
from conftest import _js, make_browser_page, panel_ready, use_page

from foliplus import LayerControl

_NAME = "Facility Points"
_SCORES = [10, 20, 30, 40, 50, 60]


def _layer() -> folium.GeoJson:
    features = [
        {
            "type": "Feature",
            "properties": {"score": score},
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
        for i, score in enumerate(_SCORES)
    ]
    return folium.GeoJson(
        json.dumps({"type": "FeatureCollection", "features": features}),
        name=_NAME,
        style_function=lambda _feature: {
            "fillColor": "#808080",
            "fillOpacity": 0.8,
            "color": "none",
        },
        foliplus={
            "fill": {
                "ramp": {
                    "field": "score",
                    "method": "equal",
                    "classes": 3,
                    "scheme": "Reds",
                }
            }
        },
    )


def _make_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    _layer().add_to(m)
    LayerControl(locale="en").add_to(m)
    return make_browser_page(browser, tmp_path, m.get_root().render(), "declared_fill")


# Open the drawer / click Reset (#781's arm probe does both).
_ARM = _js("LayerControl/fill_author_arm")
# Pick a palette the way a user does: open the trigger, press the row.
_PICK_SCHEME = _js("LayerControl/pick_fill_scheme")
# Read the declared by-value row: arm, values and the painted colors.
_READ_FILL = _js("LayerControl/fill_declared_read")


def _open_style_panel(page) -> None:
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded",
        state="attached",
        timeout=5000,
    )
    panel_ready(page)
    opened = page.evaluate(_ARM)
    assert opened["ok"], f"style panel did not open: {opened}"
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible", timeout=5000)


class TestDeclaredFillBrowser:
    """The declaration paints at load, survives Reset and yields to the user."""

    def test_declared_ramp_paints_at_load_and_resets_to_declaration(
        self, browser, tmp_path
    ):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-layer-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            # The declaration is a read-time default: the map must be painted
            # by value before the user touches the panel. The row itself is not
            # open yet, so only the painted colors are readable here.
            before_panel = page.evaluate(_READ_FILL)
            assert len(before_panel["fills"]) >= 2, (
                f"the declared ramp did not reach the map at load: {before_panel}"
            )
            assert "#808080" not in before_panel["fills"], (
                f"the map kept the author's flat fill: {before_panel}"
            )

            _open_style_panel(page)
            initial = page.evaluate(_READ_FILL)
            assert initial["mode"] == "ramp", initial
            assert initial["originalAvailable"] is False, initial
            assert initial["hasSwatch"] is False, initial
            assert initial["field"] == "score", initial
            assert initial["classes"] == "3", initial
            assert initial["schemeTitle"] == "Reds", initial
            assert initial["fills"] == before_panel["fills"], initial

            # A panel edit is the user's intent: it repaints the map and the
            # row now reads the user's scheme.
            scheme = page.evaluate(_PICK_SCHEME, {"scheme": "Blues"})
            assert scheme["ok"], f"scheme pick failed: {scheme}"
            page.wait_for_timeout(300)
            taken = page.evaluate(_READ_FILL)
            assert taken["schemeTitle"] == "Blues", taken
            assert taken["fills"] != initial["fills"], (
                f"choosing a scheme did not repaint the map: {taken}"
            )

            # Reset clears the user's intent, so the declaration shows through
            # again — the declared scheme and the declared paint, not the
            # author's flat color.
            page.evaluate(_ARM, {"reset": True})
            page.wait_for_timeout(300)
            _open_style_panel(page)
            restored = page.evaluate(_READ_FILL)
            assert restored["mode"] == "ramp", restored
            assert restored["field"] == "score", restored
            assert restored["classes"] == "3", restored
            assert restored["schemeTitle"] == "Reds", restored
            assert restored["fills"] == initial["fills"], (
                f"Reset did not restore the declared ramp: {restored}"
            )

            # The user's choice wins across a reload; the declaration is still
            # what Reset would return to.
            page.evaluate(_PICK_SCHEME, {"scheme": "Blues"})
            page.wait_for_timeout(300)
            page.reload()
            page.wait_for_selector(
                ".foliplus-layer-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            _open_style_panel(page)
            reloaded = page.evaluate(_READ_FILL)
            assert reloaded["schemeTitle"] == "Blues", reloaded
            assert reloaded["mode"] == "ramp", reloaded

            assert not errors, f"JS errors: {errors}"
