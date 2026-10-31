"""Browser test: the fill row shows an explore layer's original colors.

A geopandas explore layer writes one color per feature (the feature's
__folium_color) and mounts a branca colormap on the map. CONFIG carries both as
fillAuthor, and the fill row opens on a read-only "Original colors" arm — the
author's column, their colors as one ordered gradient and their count, no
Method/Classes/Scheme controls — while offering that arm as a real choice the
user can leave and come back to. The fixture builds the same shape with folium
+ branca directly (explore is not a test dependency), so the assertion covers
the JS path and the Python metadata without pulling geopandas into CI.
"""

from __future__ import annotations

import json

import branca.colormap as branca_cm
import folium
import pytest
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
    "Colors set per feature by geopandas.GeoDataFrame.explore. "
    "Editing the fill overrides them; Reset restores them."
)
_ORIGINAL = "Original colors"


def _open_style_panel(page):
    """Open the row's style drawer: the more menu, then the style entry."""
    page.evaluate(_js("LayerControl/open_panel"))
    opened = page.evaluate(_ARM)
    assert opened["ok"], f"style panel did not open: {opened}"
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible", timeout=5000)


class TestFillAuthorBrowser:
    """An explore layer opens on its original colors and can come back to them."""

    def test_original_colors_override_and_reset(self, browser, tmp_path):
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
            _open_style_panel(page)

            # The read-only original-colors arm: the scale's column, the
            # author's colors in author order and their count, and none of the
            # classification controls. The map still shows the author's paint.
            initial = page.evaluate(_READ_FILL)
            assert initial["mode"] == "original", initial
            assert initial["originalAvailable"] is True, initial
            assert initial["originalDisabled"] is False, initial
            assert initial["originalLabel"] == _ORIGINAL, initial
            assert initial["note"] == _NOTE, initial
            assert initial["column"] == "score", initial
            assert initial["count"] == "—", initial
            # A continuous scale has no classification: the method row still
            # renders (the arm stays aligned with the by-value grid) but states
            # the same dash the count row does — nothing is invented.
            assert initial["method"] == "—", initial
            # The method readout spans the control column (left/right/width equal
            # to the colors box), the count readout hugs the right edge at the
            # compact secondary width, and the count value is centered while the
            # method value is not (a spanning readout reads as a label).
            m = initial["methodGeom"]
            c = initial["countGeom"]
            k = initial["colorsGeom"]
            assert m is not None and c is not None and k is not None, initial
            assert (
                m["left"] == k["left"]
                and m["right"] == k["right"]
                and m["width"] == k["width"]
            ), initial
            assert c["right"] == k["right"], initial
            assert c["width"] == initial["secondaryWidth"], (
                f"count width {c['width']} != secondary {initial['secondaryWidth']}: {initial}"
            )
            # The count value is centered by the stylesheet (style.css rule
            # .foliplus-style-fill-original-count .foliplus-style-fill-original-value
            # { text-align: center }), read here via getComputedStyle because the
            # inline style is always empty. Negative control: deleting that
            # text-align line turns this assertion red on the browser job —
            # do not weaken it to read the inline style.
            assert initial["countTextAlign"] == "center", initial
            assert initial["caption"] == "Original · continuous", initial
            assert initial["colorsLabel"] == "Original · continuous", initial
            assert initial["gradient"].startswith("linear-gradient(90deg,"), initial
            # A continuous scale is sampled down to a readable number of stops
            # instead of one DOM block per color.
            assert 2 <= initial["stops"] <= 12, initial
            # The read-only detail holds nothing to operate.
            assert initial["detailSelects"] == 0, initial
            assert initial["detailComboboxes"] == 0, initial
            assert initial["detailFocusable"] == 0, initial
            assert len(initial["rows"]) == 4, initial
            assert all("foliplus-form-row" in row for row in initial["rows"]), initial
            assert initial["hasField"] is False, initial
            assert initial["hasMethod"] is False, initial
            assert initial["hasClasses"] is False, initial
            assert initial["hasScheme"] is False, initial
            assert initial["hasSwatch"] is False, initial
            assert initial["noteInPanel"] is False, initial
            assert len(initial["fills"]) >= 2, (
                f"the map did not paint per-feature author colors: {initial}"
            )

            # Activating the arm it is already in writes nothing and repaints
            # nothing: it is a stored choice, not a state change.
            page.evaluate(_ARM, {"original": True})
            page.wait_for_timeout(300)
            unchanged = page.evaluate(_READ_FILL)
            assert unchanged["mode"] == "original", unchanged
            assert unchanged["fills"] == initial["fills"], (
                f"activating the original-colors arm repainted the map: {unchanged}"
            )

            # Choosing the solid arm takes the fill over with one color.
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

            # The arm is offered again — the stored state, not a one-way door —
            # and picking it puts the author's own colors back on the map.
            assert taken["originalAvailable"] is True, taken
            page.evaluate(_ARM, {"original": True})
            page.wait_for_timeout(300)
            back = page.evaluate(_READ_FILL)
            assert back["mode"] == "original", back
            assert back["fills"] == initial["fills"], (
                f"the original-colors arm did not restore the author colors: {back}"
            )
            assert back["hasSwatch"] is False, back

            # Reset returns the same state from the other direction.
            page.evaluate(_ARM, {"solid": True})
            page.wait_for_timeout(300)
            page.evaluate(_ARM, {"reset": True})
            page.wait_for_timeout(300)
            _open_style_panel(page)
            restored = page.evaluate(_READ_FILL)
            assert restored["mode"] == "original", restored
            assert restored["fills"] == initial["fills"], (
                f"Reset did not restore the author colors: {restored}"
            )
            assert not errors, f"JS errors: {errors}"

    @pytest.mark.parametrize("width", [380, 480, 768, 1000])
    def test_read_only_rows_fit_every_viewport(self, browser, tmp_path, width):
        """The read-only rows fit the panel at every viewport, 380px included.

        The panel has its own width, but the control column is resolved from
        the viewport: the rows must not overflow it at any of the widths the
        user's screenshots came from.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.set_viewport_size({"width": width, "height": 900})
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
            _open_style_panel(page)

            read = page.evaluate(_READ_FILL)
            assert read["mode"] == "original", read
            assert read["panelScroll"] <= 0, (width, read)
            assert read["boxRightMax"] <= read["panelRight"], (width, read)
            assert read["stops"] >= 2, (width, read)
            assert not errors, f"JS errors: {errors}"
