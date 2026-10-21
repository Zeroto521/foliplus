"""Browser tests: row-panel viewport-aware placement.

`createRowPanel` measures the space above and below its anchor row and
writes a per-panel `--foliplus-row-panel-max-height` CSS variable, so
the panel caps itself to the visible strip and flips upward when the
space below is the tight side. These tests pin the three scenarios that
motivated the fix.

Each test opens the LayerControl, clicks ⋮ → Style on a layer row, and
asserts the panel's rendered rect against the map's visible area.
Screenshots are written to `.foliplus/` for visual confirmation.
"""

from __future__ import annotations

from pathlib import Path

import folium
from conftest import make_browser_page, panel_ready, use_page

from foliplus import LayerControl

HERE = Path(__file__).resolve().parents[3]
SHOTS = HERE / ".foliplus"

# Shared JS: open the ⋮ → Style panel on the row at *index*.
OPEN_PANEL = r"""
(index) => {
  const rows = Array.from(
    document.querySelectorAll('.foliplus-layer-item[data-layer-type=overlay]'),
  );
  if (rows.length === 0) return { ok: false, reason: 'no-overlay-row' };
  const row = rows[index];
  if (!row) return { ok: false, reason: 'row-out-of-range', n: rows.length };
  row.querySelector('.foliplus-layer-more-btn').click();
  const menu = row.querySelector('.foliplus-layer-more-menu.open');
  if (!menu) return { ok: false, reason: 'menu-not-open' };
  const item = menu.querySelector('li[data-action="style-layer"]');
  if (!item) return { ok: false, reason: 'no-style-item' };
  item.click();
  const panel = row.querySelector('.foliplus-layer-style-panel');
  return { ok: !!panel, nRows: rows.length };
}
"""

# Shared JS: measure the open style panel against the map's visible area.
MEASURE = r"""
() => {
  const panel = document.querySelector('.foliplus-layer-style-panel');
  if (!panel) return { ok: false, reason: 'panel-missing' };
  const row = panel.closest('.foliplus-layer-item');
  if (!row) return { ok: false, reason: 'row-missing' };
  const mapEl = document.querySelector('.leaflet-container');
  if (!mapEl) return { ok: false, reason: 'map-missing' };
  const pr = panel.getBoundingClientRect();
  const mr = mapEl.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  const cs = getComputedStyle(panel);
  return {
    ok: true,
    panel: {
      top: pr.top,
      bottom: pr.bottom,
      height: pr.height,
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight,
      cssMaxHeight: cs.maxHeight,
      topCss: cs.top,
      bottomCss: cs.bottom,
    },
    row: { top: rr.top, bottom: rr.bottom },
    map: { top: mr.top, bottom: mr.bottom, height: mr.height },
    flipUp: panel.classList.contains('foliplus-row-panel--up'),
  };
}
"""


def _make_page(browser, tmp_path, n_layers: int = 5, slug: str = "lcp"):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    LayerControl().add_to(m)
    for i in range(n_layers):
        fg = folium.FeatureGroup(name=f"Layer {i:02d}", overlay=True, show=True)
        folium.Polygon(
            [
                [26.05 + i * 0.01, 119.27],
                [26.06 + i * 0.01, 119.33],
                [26.04 + i * 0.01, 119.30],
            ],
            color="#0000ff",
            weight=2,
            fill=True,
        ).add_to(fg)
        folium.Marker([26.08 + i * 0.01, 119.30 + i * 0.01]).add_to(fg)
        fg.add_to(m)
    html = m.get_root().render()
    page, errors = make_browser_page(browser, tmp_path, html, slug)
    page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
    page.evaluate(
        "() => { const c = document.querySelector('.foliplus-layer-ctrl'); if (!c.classList.contains('foliplus-is-expanded')) c.querySelector('.foliplus-toggle-btn').click(); return true; }"
    )
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded",
        state="attached",
        timeout=5000,
    )
    page.wait_for_selector(
        ".foliplus-layer-item[data-layer-type=overlay]",
        state="attached",
        timeout=5000,
    )
    panel_ready(page)
    return page, errors


class TestRowPanelLayoutBrowser:
    """Row-panel placement against the map's visible area.

    The panel is a `position: absolute; top: 100%` child of its row,
    capped by a per-panel CSS variable that `createRowPanel` writes from
    a measurement of the space above and below the anchor. These tests
    pin the three scenarios from the reported clipping bug.
    """

    def test_style_panel_first_row_fits_in_first_screen(self, browser, tmp_path):
        """1280x720, top row: the panel's bottom must stay inside the map.

        The reported bug was a 400px max-height on a panel whose bottom
        row fell below the first screen. The panel caps itself to the
        visible strip, so its bottom edge never crosses the map's bottom.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.set_viewport_size({"width": 1280, "height": 720})
            page.wait_for_timeout(300)

            r = page.evaluate(OPEN_PANEL, 0)
            assert r["ok"] is True, f"setup failed: {r}"
            page.wait_for_timeout(300)  # let the placement settle

            r = page.evaluate(MEASURE)
            assert r["ok"] is True, f"measure failed: {r}"

            assert r["panel"]["bottom"] <= r["map"]["bottom"], (
                f"panel bottom ({r['panel']['bottom']:.1f}) crosses the map "
                f"bottom ({r['map']['bottom']:.1f}); the panel must fit "
                f"inside the visible area"
            )
            assert r["panel"]["cssMaxHeight"] != "400px", (
                "the panel's max-height is still the token default (400px); "
                "createRowPanel should have written a measured cap"
            )
            page.screenshot(path=str(SHOTS / "accept_1_style_720.png"))
            assert not errors, f"JS errors: {errors}"

    def test_style_panel_500px_viewport_fits(self, browser, tmp_path):
        """1280x500, top row: the panel must not overflow the map.

        A short viewport leaves less room below the anchor, so the panel
        cap shrinks. The panel still opens downward (there is enough
        room below) but must not cross the map's bottom edge.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.set_viewport_size({"width": 1280, "height": 500})
            page.wait_for_timeout(300)

            r = page.evaluate(OPEN_PANEL, 0)
            assert r["ok"] is True, f"setup failed: {r}"
            page.wait_for_timeout(300)

            r = page.evaluate(MEASURE)
            assert r["ok"] is True, f"measure failed: {r}"

            assert r["panel"]["bottom"] <= r["map"]["bottom"], (
                f"panel bottom ({r['panel']['bottom']:.1f}) crosses the map "
                f"bottom ({r['map']['bottom']:.1f}) in a 500px viewport"
            )
            assert r["panel"]["height"] <= 500, (
                f"panel height ({r['panel']['height']:.1f}) exceeds the "
                f"viewport height (500)"
            )
            page.screenshot(path=str(SHOTS / "accept_2_style_500px.png"))
            assert not errors, f"JS errors: {errors}"

    def test_style_panel_bottom_row_flips_upward(self, browser, tmp_path):
        """Bottom row, 1280x720: the panel must open upward.

        A row near the map's bottom edge has little space below, so the
        panel flips above the row via the `--up` modifier. The panel's
        top edge must stay inside the map.

        Uses 10 layers so the last row lands near the map's bottom edge,
        where the space below is tighter than the panel's natural height.
        """
        with use_page(_make_page, browser, tmp_path, 10) as (page, errors):
            page.set_viewport_size({"width": 1280, "height": 720})
            page.wait_for_timeout(300)

            r = page.evaluate(OPEN_PANEL, 9)  # last of 10 layers
            assert r["ok"] is True, f"setup failed: {r}"
            page.wait_for_timeout(300)

            r = page.evaluate(MEASURE)
            assert r["ok"] is True, f"measure failed: {r}"

            assert r["flipUp"] is True, (
                f"the bottom-row panel did not flip upward; panel rect "
                f"top={r['panel']['top']:.1f} bottom={r['panel']['bottom']:.1f}, "
                f"row top={r['row']['top']:.1f} bottom={r['row']['bottom']:.1f}, "
                f"map bottom={r['map']['bottom']:.1f}; the space below "
                f"is the tight side and the panel should re-anchor above"
            )
            assert r["panel"]["top"] >= r["map"]["top"], (
                f"flipped panel top ({r['panel']['top']:.1f}) is above the "
                f"map top ({r['map']['top']:.1f}); the panel must fit inside"
            )
            assert r["panel"]["top"] < r["row"]["top"], (
                f"flipped panel top ({r['panel']['top']:.1f}) is not above "
                f"its row top ({r['row']['top']:.1f})"
            )
            page.screenshot(path=str(SHOTS / "accept_3_style_flip.png"))
            assert not errors, f"JS errors: {errors}"
