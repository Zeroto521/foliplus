"""Browser tests: the layer row's press/hover wash and its pinned panel.

The row panel (style/attrs) and the ⋮ menu are appended inside the row DOM, so
CSS matching on the row would reach controls that are not the row itself. Two
rules keep that honest: :active must not wash the owner row when a panel or menu
control is pressed (though a real row press still washes), and :hover on the
shared row-panel shell must return the owner row to its resting background.

The carve-out is keyed on `.foliplus-row-panel` — the shell every row panel
(style and attrs) mounts with — not on the style panel's own
`.foliplus-layer-style-panel` class, which belongs to style.css and is never
named by a row.css rule (the merged-CSS duplicate-token guard would reject it).

The panel also has to stay inside the map while floating over the control: it is
fixed, capped by a per-panel CSS variable measured from the space above and
below its anchor, and it flips upward when the space below is the tight side.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import folium
from conftest import (
    _js,
    leaflet_path,
    load_geojson,
    make_browser_page,
    panel_ready,
    snippet,
    use_page,
)

from foliplus import LayerControl

_ROW = '.foliplus-layer-item[data-layer-type="overlay"]'
_PANEL = ".foliplus-layer-style-panel"
_READ = _js("LayerControl/read_row_hover_carveout")

HERE = Path(__file__).resolve().parents[4]
SHOTS = HERE / ".foliplus"

# The probes live next to the other browser JS so they are formatted, reviewed
# and diffed as JavaScript instead of as Python string literals.
# `layer/row_panel_open` opens the ⋮ → Style panel on the row at *index*;
# `layer/row_panel_measure` reports the open card against the map's visible area.
OPEN_PANEL = snippet("LayerControl/row_panel_open")
MEASURE = snippet("LayerControl/row_panel_measure")


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


def _make_layout_page(browser, tmp_path, n_layers: int = 5, slug: str = "lcp"):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    LayerControl().add_to(m)
    base_polygon = leaflet_path("LayerControl", "polygon_row_layout")
    for i in range(n_layers):
        fg = folium.FeatureGroup(name=f"Layer {i:02d}", overlay=True, show=True)
        folium.Polygon(
            [[lat + i * 0.01, lng] for lat, lng in base_polygon],
            color="#0000ff",
            weight=2,
            fill=True,
        ).add_to(fg)
        folium.Marker([26.08 + i * 0.01, 119.30 + i * 0.01]).add_to(fg)
        fg.add_to(m)
    html = m.get_root().render()
    page, errors = make_browser_page(browser, tmp_path, html, slug)
    page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
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
    return page, errors



class TestMoreMenuPlacementBrowser:
    """The ⋮ overflow menu opens against its owning row's clip container.

    The menu is fixed and placed by computePlacement against the panel
    content box (the nearest visible clip container). A bottom-row menu
    must flip upward and stay fully inside the clip; a top-row menu must
    open downward and also stay inside. When the clip is too short the
    menu is capped and scrolls internally.
    """

    def test_more_menu_stays_inside_clip_and_flips(self, browser, tmp_path):
        """First and last row: menu rect inside clip, correct side."""
        with use_page(_make_layout_page, browser, tmp_path, 10) as (page, errors):
            page.set_viewport_size({"width": 1280, "height": 720})
            page.wait_for_timeout(300)
            r = page.evaluate(snippet("LayerControl/more_menu_placement"))
            assert r["first"] is not None and r["last"] is not None, (
                f"probe failed: {r}"
            )
            # Top row opens downward, inside the clip.
            assert r["first"]["inside"] is True, (
                f"first-row menu escaped its clip: {r['first']}"
            )
            assert r["first"]["side"] == "below", (
                f"first-row menu should open below: {r['first']}"
            )
            # Bottom row flips upward, still inside the clip.
            assert r["last"]["inside"] is True, (
                f"last-row menu escaped its clip: {r['last']}"
            )
            assert r["last"]["side"] == "above", (
                f"last-row menu should flip above: {r['last']}"
            )
            page.screenshot(path=str(SHOTS / "accept_4_more_menu_flip.png"))
            assert not errors, f"JS errors: {errors}"

class TestRowPanelLayoutBrowser:
    """Row-panel placement against the map's visible area.

    The card is fixed (pinned above the layer list's scroll box) but is
    capped by a per-panel CSS variable that `placeRowPanel` writes from a
    measurement of the space above and below the anchor. These tests pin
    the three scenarios from the reported clipping bug.
    """

    def test_style_panel_first_row_fits_in_first_screen(self, browser, tmp_path):
        """1280x720, top row: the panel's bottom must stay inside the map.

        The reported bug was a 400px max-height on a panel whose bottom
        row fell below the first screen. The panel caps itself to the
        visible strip, so its bottom edge never crosses the map's bottom.
        """
        with use_page(_make_layout_page, browser, tmp_path) as (page, errors):
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
                "placeRowPanel should have written a measured cap"
            )
            page.screenshot(path=str(SHOTS / "accept_1_style_720.png"))
            assert not errors, f"JS errors: {errors}"

    def test_style_panel_500px_viewport_fits(self, browser, tmp_path):
        """1280x500, top row: the panel must not overflow the map.

        A short viewport leaves less room below the anchor, so the panel
        cap shrinks. The panel still opens downward (there is enough
        room below) but must not cross the map's bottom edge.
        """
        with use_page(_make_layout_page, browser, tmp_path) as (page, errors):
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
        panel flips above the row via the upward modifier. The panel's
        top edge must stay inside the map.

        Uses 10 layers so the last row lands near the map's bottom edge,
        where the space below is tighter than the panel's natural height.
        """
        with use_page(_make_layout_page, browser, tmp_path, 10) as (page, errors):
            page.set_viewport_size({"width": 1280, "height": 720})
            page.wait_for_timeout(300)

            r = page.evaluate(OPEN_PANEL, 9)  # last of 10 layers
            assert r["ok"] is True, f"setup failed: {r}"
            page.wait_for_timeout(300)

            r = page.evaluate(MEASURE)
            assert r["ok"] is True, f"measure failed: {r}"

            assert r["flipUp"] is True, (
                "the bottom-row panel did not flip upward; the space below "
                "is the tight side and the panel should re-anchor above"
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
