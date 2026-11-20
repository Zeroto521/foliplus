"""Browser regression: a small ⋮ overflow menu must not scroll.

User report (screenshot): the overflow menu of a layer row was tiny yet showed
both a horizontal and a vertical scrollbar, and "Confirm Delete" was clipped.
Root causes fixed in this change:

* common/menu.css set `overflow-y: auto` on the shared menu shell, which makes
  `overflow-x` compute to `auto` too — a nowrap label wider than the shell
  produced a horizontal scrollbar.
* control/LayerControl/menu.css pinned `min-width: 112px` while the buttons
  are `white-space: nowrap`, so a long label ("Confirm Delete") overflowed.
* ui/overlayPanel/menu.ts wrote `maxHeight = placement.maxHeight` unconditionally;
  the placement engine caps to the strip between the anchor and the clip edge,
  which is tighter than a small menu near the panel bottom, forcing a scroll.

Guard: a 5-item menu (a tile basemap has Style / Focus / Rename / Attributes /
Delete — no filter row) must fit its scrollport on both axes after opening, and
the shared thin + stable-gutter scrollbar recipe must have applied.
"""

from __future__ import annotations

import folium
import pytest
from conftest import _js, make_browser_page, panel_ready

from foliplus import LayerControl


class TestMoreMenuScrollBrowser:
    """The ⋮ overflow menu never scrolls when the item list is small."""

    @pytest.mark.browser
    def test_small_menu_no_scrollbar(self, browser, tmp_path):
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        # A tile basemap is a data row with Style / Focus / Rename / Attributes /
        # Delete — no Filter row (tile layers have no filterable fields), so the
        # menu is exactly the 5-item small case from the user report.
        folium.TileLayer("OpenStreetMap").add_to(m)
        html = m.get_root().render()
        page, errors = make_browser_page(browser, tmp_path, html, "small_menu")
        try:
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/measure_more_menu_scroll"))
            assert result["ok"], f"probe failed: {result.get('reason')}"
            assert result["itemCount"] == 5, (
                f"expected a 5-item menu, got {result['itemCount']}"
            )
            # The no-scroll invariant: content fits the scrollport on both axes.
            assert result["noHScroll"], (
                f"menu scrolls horizontally: scrollWidth={result['scrollWidth']} "
                f"clientWidth={result['clientWidth']}"
            )
            assert result["noVScroll"], (
                f"menu scrolls vertically: scrollHeight={result['scrollHeight']} "
                f"clientHeight={result['clientHeight']}"
            )
            # The shared recipe applied (computed values, not the token string).
            assert result["scrollbarWidth"] == "thin", (
                f"scrollbar-width not thin: {result['scrollbarWidth']}"
            )
            assert result["scrollbarGutter"] == "stable", (
                f"scrollbar-gutter not stable: {result['scrollbarGutter']}"
            )
            # The menu is at least as wide as its content (no horizontal clip).
            assert result["menuWidth"] >= result["scrollWidth"], (
                f"menu clips content: width={result['menuWidth']} "
                f"scrollWidth={result['scrollWidth']}"
            )
            # "Confirm Delete" (armed state's label) is the widest item; it must
            # be present and not clipped. The menu renders "Delete Layer"/"Clear
            # Data" at rest; the armed label is "Confirm Delete".
            assert result["confirmDeleteVisible"], "delete entry not found in menu"
        finally:
            page.close()
        assert errors == [], f"console errors: {errors}"
