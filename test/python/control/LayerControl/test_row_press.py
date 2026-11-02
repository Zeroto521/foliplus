"""Browser tests: row :active scoping.

The row panel (style/attrs) and the ⋮ menu are appended inside the row
DOM.  CSS :active matches the pressed element and every ancestor, so a
press on any panel/menu control would light the owner row's press wash
unless the rule carves them out with :not(:has(...)).

These three tests pin the carve-out: panel press, menu press, and the
regression that a real row press still washes.
"""

from __future__ import annotations

import folium
from conftest import _js, make_browser_page, panel_ready, use_page

from foliplus import LayerControl


class TestRowPressScopeBrowser:
    """Press wash must not leak through row-internal overlays.

    CSS :active matches the pressed element plus every ancestor.  The
    row panel and ⋮ menu live inside the row, so a press on any of
    their controls activates the row too.  The :not(:has(...)) carve-out
    in row.css scopes the wash to real row interaction.
    """

    @staticmethod
    def _make_page(browser, tmp_path, *layers, slug="lc"):
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        for layer in layers:
            layer.add_to(m)
        html = m.get_root().render()
        page, errors = make_browser_page(browser, tmp_path, html, slug)
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        return page, errors

    @staticmethod
    def _sample_wash(page) -> str:
        """Computed value of --foliplus-accent-soft-bg — never hardcode a hex/rgb."""
        return page.evaluate(
            _js("LayerControl/sample_token"), "--foliplus-accent-soft-bg"
        )

    @staticmethod
    def _read_row_bg(page) -> str:
        """Computed background-color of the first overlay row."""
        return page.evaluate(_js("LayerControl/read_row_bg"))

    def _open_panel(self, page):
        page.evaluate(_js("LayerControl/open_panel"))
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
        page.mouse.move(5, 400)  # pointer off the panel: no hover

    def test_press_inside_style_panel_does_not_wash_row(self, browser, tmp_path):
        """A press on a control inside the style panel must not light the row.

        The row panel is appended inside the row, and CSS :active matches
        the pressed element plus every ancestor.  The :not(:has(...))
        carve-out keeps the wash off the owner row while a panel control
        is pressed.
        """
        layer = folium.FeatureGroup(name="Style target", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            self._open_panel(page)
            wash = self._sample_wash(page)

            # Open ⋮ → Style on the first overlay row.
            r = page.evaluate(_js("LayerControl/open_style_panel"))
            assert r["ok"] is True, f"style panel did not open: {r}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )
            page.wait_for_timeout(200)  # let the panel settle

            # Press on the reset button inside the panel.
            btn = page.locator(".foliplus-layer-style-panel .foliplus-style-reset-btn")
            btn.hover()
            page.mouse.down()
            try:
                bg = self._read_row_bg(page)
            finally:
                page.mouse.up()

            assert bg != wash, (
                "a press inside the style panel must not light the owner row; "
                f"row bg={bg}, wash={wash}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_press_on_row_label_still_washes(self, browser, tmp_path):
        """Regression: a press on the row's own label area must still wash.

        The carve-out is scoped to :has(.foliplus-row-panel :active,
        .foliplus-layer-more-menu :active).  A press on the row's label,
        checkbox, or drag-cell is not inside either overlay, so the wash
        must still apply.
        """
        layer = folium.FeatureGroup(name="Row press", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            self._open_panel(page)
            wash = self._sample_wash(page)

            # Hover the row's label (the text cell) and press.
            label = page.locator(
                ".foliplus-layer-item[data-layer-type=overlay] .foliplus-layer-label"
            )
            label.hover()
            page.mouse.down()
            try:
                bg = self._read_row_bg(page)
            finally:
                page.mouse.up()

            assert bg == wash, (
                "a press on the row label must show the press wash; "
                f"row bg={bg}, wash={wash}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_press_on_menu_item_does_not_wash_row(self, browser, tmp_path):
        """A press on a ⋮ menu item must not light the row.

        The ⋮ menu is appended inside the row, and CSS :active matches
        the pressed element plus every ancestor.  The :not(:has(...))
        carve-out keeps the wash off the owner row while a menu item is
        pressed.
        """
        layer = folium.FeatureGroup(name="Menu target", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            self._open_panel(page)
            wash = self._sample_wash(page)

            # Open the ⋮ menu on the first overlay row.
            ROW = ".foliplus-layer-item[data-layer-type=overlay]"
            page.evaluate(_js("LayerControl/click_first_row_more_btn"), ROW)
            page.wait_for_selector(
                ".foliplus-layer-more-menu.open", state="visible", timeout=5000
            )
            page.wait_for_timeout(200)  # let the menu settle

            # Press on the first menu item (focus-layer).
            item = page.locator(
                ".foliplus-layer-more-menu.open button[data-action='focus-layer']"
            )
            item.hover()
            page.mouse.down()
            try:
                bg = self._read_row_bg(page)
            finally:
                page.mouse.up()

            assert bg != wash, (
                "a press on a ⋮ menu item must not light the owner row; "
                f"row bg={bg}, wash={wash}"
            )
            assert not errors, f"JS errors: {errors}"
