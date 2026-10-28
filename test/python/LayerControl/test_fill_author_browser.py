"""Browser test: the fill row shows an explore layer's original colours.

A geopandas explore layer writes one colour per feature (the feature's
__folium_color) and mounts a branca colormap on the map. CONFIG carries both as
fillAuthor, and the fill row must open on a read-only "Original colours" state —
the author's strip and caption, no Method/Classes/Scheme controls — instead of
claiming one solid colour or re-classifying the author's palette into the
panel's nine classes. The fixture builds the same shape with folium + branca
directly (explore is not a test dependency), so the assertion covers the JS path
and the Python metadata without pulling geopandas into CI.
"""

from __future__ import annotations

import json

import branca.colormap as branca_cm
import folium
from conftest import _js, make_browser_page, panel_ready, use_page

from foliplus import LayerControl

_SCORES = [10.0, 11.0, 12.0, 13.0, 14.0, 15.0]


def _scale() -> branca_cm.LinearColormap:
    """A continuous scale with the 256-point resolution explore produces."""
    base = branca_cm.LinearColormap(["#0d0887", "#f0f921"], vmin=10, vmax=15)
    dense = [str(base(10 + 5 * step / 255))[:7] for step in range(256)]
    return branca_cm.LinearColormap(dense, vmin=10, vmax=15, caption="score")


def _layer(scale: branca_cm.LinearColormap) -> folium.GeoJson:
    colors = [str(scale(score))[:7] for score in _SCORES]
    features = [
        {
            "type": "Feature",
            "properties": {"__folium_color": color, "cat": f"c{i}", "score": score},
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
        for i, (color, score) in enumerate(zip(colors, _SCORES, strict=True))
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
    scale = _scale()
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    scale.add_to(m)
    _layer(scale).add_to(m)
    LayerControl(locale="en").add_to(m)
    return make_browser_page(browser, tmp_path, m.get_root().render(), "fill_author")


# Page snippets live in test/js/browser/LayerControl, the same split the
# menu-keyboard browser test uses: one file to drive the panel, one to read it.
_ARM = _js("LayerControl/fill_author_arm")
_READ_FILL = _js("LayerControl/fill_author_read")

# Locale text the row must expose as a tooltip instead of a paragraph.
_NOTE = (
    "Colours set per feature by geopandas.GeoDataFrame.explore. "
    "Editing the fill overrides them; Reset restores them."
)
_ORIGINAL = "Original colours"


class TestFillAuthorBrowser:
    """An explore layer opens on its original colours and restores them."""

    def test_original_colours_override_and_reset(self, browser, tmp_path):
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

            # The read-only original-colours state: the scale's column, the
            # author's strip and caption, and none of the classification
            # controls. The map still shows the author's own paint.
            initial = page.evaluate(_READ_FILL)
            assert initial["mode"] == "feature", initial
            assert initial["featureAvailable"] is True, initial
            assert initial["featureDisabled"] is True, initial
            assert initial["featureLabel"] == _ORIGINAL, initial
            assert initial["note"] == _NOTE, initial
            assert initial["column"] == "score", initial
            assert initial["caption"] == "Original · continuous", initial
            assert initial["stripBlocks"] == 64, initial
            assert initial["stripHeight"] > 0, initial
            assert initial["hasField"] is False, initial
            assert initial["hasMethod"] is False, initial
            assert initial["hasClasses"] is False, initial
            assert initial["hasScheme"] is False, initial
            assert initial["hasSwatch"] is False, initial
            assert initial["noteInPanel"] is False, initial
            assert len(initial["fills"]) >= 2, (
                f"the map did not paint per-feature author colours: {initial}"
            )

            # The original-colours entry is the state, not a choice: activating
            # it must not write an intent or repaint the map.
            feature_result = page.evaluate(_ARM, {"feature": True})
            assert feature_result["ok"], f"feature entry click failed: {feature_result}"
            page.wait_for_timeout(300)
            unchanged = page.evaluate(_READ_FILL)
            assert unchanged["mode"] == "feature", unchanged
            assert unchanged["fills"] == initial["fills"], (
                f"activating the original-colours entry repainted the map: {unchanged}"
            )

            # Choosing the solid arm takes the fill over with one colour.
            solid_result = page.evaluate(_ARM, {"solid": True})
            assert solid_result["ok"], f"solid switch failed: {solid_result}"
            page.wait_for_timeout(300)
            taken = page.evaluate(_READ_FILL)
            assert taken["mode"] == "solid", taken
            assert taken["hasSwatch"] is True, taken
            assert len(taken["fills"]) == 1, (
                f"the solid arm did not repaint the map: {taken}"
            )
            assert taken["fills"] != initial["fills"], taken

            # Reset returns the author's per-feature paint and the read-only
            # state, with no classification rows.
            page.evaluate(_ARM, {"reset": True})
            page.wait_for_timeout(300)
            page.evaluate(_js("LayerControl/open_panel"))
            reopened = page.evaluate(_ARM)
            assert reopened["ok"], f"style panel did not reopen: {reopened}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )
            restored = page.evaluate(_READ_FILL)
            assert restored["mode"] == "feature", restored
            assert restored["fills"] == initial["fills"], (
                f"Reset did not restore the author colours: {restored}"
            )
            assert restored["hasScheme"] is False, restored
            assert not errors, f"JS errors: {errors}"
