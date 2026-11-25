"""Browser tests: the row's press and hover wash.

A row press must wash the owner row with the accent-soft token, but a press on
a control appended inside the row (the style panel, the ⋮ menu) must not: CSS
:active matches ancestors, so the row.css carve-out keys the wash on real row
interaction. A click on one overlay checkbox must not repaint a sibling's
checkbox between the click and the settle. Hovering the shared row-panel shell
returns the owner row to its resting background, while hovering the row itself
still lights it.
"""

from __future__ import annotations

import copy
import json

import folium
from conftest import _js, load_geojson, make_browser_page, panel_ready, use_page

from foliplus import LayerControl

_ROW = '.foliplus-layer-item[data-layer-type="overlay"]'
_PANEL = ".foliplus-layer-style-panel"
_READ = _js("LayerControl/read_row_hover_carveout")


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
        layer = folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "polygon_zone_a")),
            name="Style target",
            overlay=True,
            show=True,
        )
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

            # Press on a control inside the panel. The Reset button is
            # disabled on a pristine layer (nothing to restore) and a disabled
            # button rejects pointer events, so the opacity row stands in for
            # "a control inside the panel" here.
            btn = page.locator(
                ".foliplus-layer-style-panel .foliplus-style-opacity-track"
            )
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
        layer = folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "polygon_zone_a")),
            name="Row press",
            overlay=True,
            show=True,
        )
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
        layer = folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "polygon_zone_a")),
            name="Menu target",
            overlay=True,
            show=True,
        )
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

    def test_click_one_overlay_no_sibling_checkbox_flash(self, browser, tmp_path):
        """Clicking one overlay row's checkbox must not flash its role siblings'
        checkboxes to an intermediate state.

        Regression for "sibling checkbox flashes when clicking one overlay
        row": a sibling checkbox
        briefly showing a state it was not already in means an intermediate
        sweep rewrote the row's cell between the click and its final paint. The
        single-writer path records intent for the clicked row and diffs once, so
        every sibling's checkbox stays at its start value until the browser
        settles.
        """
        overlays = [
            folium.FeatureGroup(name="Overlay A", overlay=True, show=True),
            folium.FeatureGroup(name="Overlay B", overlay=True, show=True),
            folium.FeatureGroup(name="Overlay C", overlay=True, show=True),
        ]
        with use_page(self._make_page, browser, tmp_path, *overlays) as (
            page,
            errors,
        ):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/sample_overlay_checkbox_click"))
            assert not result.get("error"), f"probe error: {result}"
            assert not errors, f"JS errors: {errors}"
            # Only the first row flipped; its two siblings kept their start
            # state throughout the click, no intermediate frame.
            assert result["finalState"][0] is False, (
                f"clicked row did not uncheck, got {result}"
            )
            for i in (1, 2):
                assert result["finalState"][i] is True, (
                    f"sibling {i} ended unchecked -- the click reached it: {result}"
                )
            # The regression: some frame between the click and the settle
            # painted a sibling's checkbox at a value different from its start.
            sibling_flips = []
            for sample in result["samples"]:
                if (
                    sample[1] != result["startState"][1]
                    or sample[2] != result["startState"][2]
                ):
                    sibling_flips.append(sample)
            assert not sibling_flips, (
                f"a sibling's checkbox flipped to an unexpected value during "
                f"the click -- checkbox flash. Samples: {sibling_flips}"
            )


def _layer() -> folium.GeoJson:
    data = copy.deepcopy(load_geojson("common", "polygons_fuzhou_3offset"))
    for feat in data["features"]:
        feat["properties"] = {}
    return folium.GeoJson(json.dumps(data), name="Polygon data", show=True)


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
    """Hovering the shared row-panel shell must not light the owner layer row.

    The carve-out is keyed on the `.foliplus-row-panel` shell that every row
    panel (style and attrs) mounts with, so this probe runs the style panel and
    the same carve-out applies to the attrs panel (computed style).
    """

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

            # Hover the shared row-panel shell (the style panel mounts with
            # it): the :where(:not(:has(...))) carve-out returns the owner row
            # to its resting wash (no white / glow).
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
