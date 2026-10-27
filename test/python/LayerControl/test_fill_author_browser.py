"""Browser test: the fill row shows an explore layer's per-feature paint.

A geopandas explore layer writes one colour per feature (both in the feature
properties' __folium_color and in the leaf options). CONFIG carries that as
fillAuthor, and the fill row must say "Per feature" instead of claiming one
solid colour - then let the user take over and put the author's colours back
on Reset. The fixture builds the same shape with folium directly (explore is
not a test dependency), so the assertion covers the JS path and the Python
metadata without pulling geopandas into CI.
"""

from __future__ import annotations

import json

import folium
from conftest import _js, make_browser_page, panel_ready, use_page

from foliplus import LayerControl

_COLORS = ["#0d0887", "#6a00a8", "#b12a90", "#e16462", "#fca636", "#f0f921"]


def _layer() -> folium.GeoJson:
    features = [
        {
            "type": "Feature",
            "properties": {"__folium_color": color, "cat": f"c{i}", "score": 10 + i},
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
        for i, color in enumerate(_COLORS)
    ]
    return folium.GeoJson(
        json.dumps({"type": "FeatureCollection", "features": features}),
        name="Facility Points",
        style_function=lambda f: {
            "fillColor": f["properties"]["__folium_color"],
            "fillOpacity": 0.8,
            "color": "none",
        },
    )


def _make_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    _layer().add_to(m)
    LayerControl(locale="en").add_to(m)
    return make_browser_page(browser, tmp_path, m.get_root().render(), "fill_author")


# Page snippets live in test/js/browser/LayerControl, the same split the
# menu-keyboard browser test uses: one file to drive the panel, one to read it.
_ARM = _js("LayerControl/fill_author_arm")
_READ_FILL = _js("LayerControl/fill_author_read")

# Locale text the row must expose as a tooltip instead of a paragraph.
_NOTE = (
    "The author paints one colour per feature (geopandas explore). "
    "Editing the fill overrides them; Reset brings them back."
)


class TestFillAuthorBrowser:
    """An explore layer opens on the author's by-value palette and restores it."""

    def test_by_value_author_palette_override_and_reset(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-layer-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)

            opened = page.evaluate(_ARM)
            assert opened["ok"], f"style panel did not open: {opened}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )

            # The author palette drives the by-value arm: field, class count and
            # the Author scheme strip all come from the layer's own data, while
            # the map still shows the author's per-feature colours (no takeover
            # until the user edits a control).
            initial = page.evaluate(_READ_FILL)
            assert initial["mode"] == "ramp", initial
            assert initial["featureAvailable"] is False, initial
            assert initial["hasSwatch"] is False, initial
            assert initial["field"] == "score", initial
            assert initial["classes"] == str(len(_COLORS)), initial
            assert initial["schemeTitle"] == "Author", initial
            assert initial["barBlocks"] == len(_COLORS), initial
            assert initial["barHeight"] > 0, initial
            assert len(initial["fills"]) >= 2, (
                f"the map did not paint per-feature author colours: {initial}"
            )

            # The current Author entry is the state, not a choice: activating it
            # must not write an intent or repaint the map.
            author_result = page.evaluate(_ARM, {"scheme": "author"})
            assert author_result["ok"], f"author entry click failed: {author_result}"
            page.wait_for_timeout(300)
            unchanged = page.evaluate(_READ_FILL)
            assert unchanged["schemeTitle"] == "Author", unchanged
            assert unchanged["mode"] == "ramp", unchanged
            assert unchanged["fills"] == initial["fills"], (
                f"clicking the current Author entry repainted the map: {unchanged}"
            )

            # Editing a control takes the fill over with a real scheme.
            scheme_result = page.evaluate(_ARM, {"scheme": "Reds"})
            assert scheme_result["ok"], f"scheme pick failed: {scheme_result}"
            page.wait_for_timeout(300)
            taken = page.evaluate(_READ_FILL)
            assert taken["schemeTitle"] == "Reds", taken
            assert taken["fills"] != initial["fills"], (
                f"choosing a scheme did not repaint the map: {taken}"
            )

            # Reset returns the author's per-feature paint and the by-value
            # author palette state.
            page.evaluate(_ARM, {"reset": True})
            page.wait_for_timeout(300)
            page.evaluate(_js("LayerControl/open_panel"))
            reopened = page.evaluate(_ARM)
            assert reopened["ok"], f"style panel did not reopen: {reopened}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )
            restored = page.evaluate(_READ_FILL)
            assert restored["mode"] == "ramp", restored
            assert restored["schemeTitle"] == "Author", restored
            assert restored["fills"] == initial["fills"], (
                f"Reset did not restore the author colours: {restored}"
            )
            assert not restored["noteInPanel"], restored
            assert not errors, f"JS errors: {errors}"
