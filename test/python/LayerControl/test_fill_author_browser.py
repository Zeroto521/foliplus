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


_OPEN_STYLE = """() => {
  const row = [...document.querySelectorAll('.foliplus-layer-item[data-layer-type=overlay]')]
    .find(r => r.textContent.includes('Facility Points'));
  if (!row) return { ok: false, reason: 'no-row' };
  row.querySelector('.foliplus-layer-more-btn').click();
  const menu = row.querySelector('.foliplus-layer-more-menu.open');
  if (!menu) return { ok: false, reason: 'no-menu' };
  const item = menu.querySelector('li[data-action="style-layer"]');
  if (!item) return { ok: false, reason: 'no-style-item' };
  item.click();
  return { ok: !!row.querySelector('.foliplus-layer-style-panel') };
}"""

_READ_FILL = """() => {
  const panel = document.querySelector('.foliplus-layer-style-panel');
  const select = panel?.querySelector('.foliplus-style-fill-mode-select');
  const featureOption = select?.querySelector('option[value="feature"]');
  const note = panel?.querySelector('.foliplus-style-fill-note');
  const swatch = panel?.querySelector('.foliplus-style-fill-color-input');
  const fills = [...new Set(
    [...document.querySelectorAll('path.leaflet-interactive')]
      .map(p => p.getAttribute('fill'))
      .filter(Boolean),
  )].sort();
  return {
    mode: select ? select.value : null,
    featureAvailable: !!featureOption,
    featureDisabled: featureOption ? featureOption.disabled : null,
    note: note ? note.textContent.trim() : null,
    hasSwatch: !!swatch,
    fills,
  };
}"""


class TestFillAuthorBrowser:
    """The fill row reads the CONF metadata, takes over, and restores."""

    def test_per_feature_state_override_and_reset(self, browser, tmp_path):
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

            opened = page.evaluate(_OPEN_STYLE)
            assert opened["ok"], f"style panel did not open: {opened}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )

            initial = page.evaluate(_READ_FILL)
            assert initial["mode"] == "feature", initial
            assert initial["featureAvailable"], initial
            assert initial["featureDisabled"] is True, initial
            assert initial["note"], initial
            assert initial["hasSwatch"] is False, initial
            assert len(initial["fills"]) >= 2, (
                f"the map did not paint per-feature colours: {initial}"
            )

            # Take the fill over with a solid colour: the per-feature option
            # goes away and the editable swatch appears.
            page.evaluate(
                """() => {
                  const select = document.querySelector('.foliplus-style-fill-mode-select');
                  select.value = 'solid';
                  select.dispatchEvent(new Event('change', { bubbles: true }));
                }"""
            )
            page.wait_for_timeout(200)
            solid = page.evaluate(_READ_FILL)
            assert solid["mode"] == "solid", solid
            assert solid["featureAvailable"] is False, solid
            assert solid["hasSwatch"] is True, solid

            # Reset returns the author's per-feature paint and the read-only
            # state, with the map back to its own colour per feature.
            page.evaluate(
                "() => document.querySelector('.foliplus-style-reset-btn').click()"
            )
            page.wait_for_timeout(300)
            page.evaluate(_js("LayerControl/open_panel"))
            reopened = page.evaluate(_OPEN_STYLE)
            assert reopened["ok"], f"style panel did not reopen: {reopened}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )
            restored = page.evaluate(_READ_FILL)
            assert restored["mode"] == "feature", restored
            assert len(restored["fills"]) >= 2, (
                f"Reset did not restore per-feature author colours: {restored}"
            )
            assert not errors, f"JS errors: {errors}"
