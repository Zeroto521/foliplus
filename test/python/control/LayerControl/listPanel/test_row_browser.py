"""Browser computed-style contract for the row-layout token families.

token.css declares two families, one token each; a row belongs to exactly one:

- **list rows** (--foliplus-row-min-height, 35.6px): the layer rows and the
  toggle-all role row — multi-column content plus interaction controls;
- **menu rows** (--foliplus-menu-row-h, 30px): one clickable option line — the
  dropdown option, the scheme picker item, the search result and the more-menu
  button.

Every assertion compares a row's computed height with the computed value of its
family token, so a future row that declares a private height (or a token that
drifts off its family) turns the test red without hardcoded pixels. The rows
outside the families are pinned too: a panel header is chrome
(--foliplus-ctrl-size) and a form row is a control row
(--foliplus-toggle-size), so neither may be "converged" onto the list rhythm.
"""

from __future__ import annotations

import json

import folium
import pytest
from conftest import _js, load_geojson, panel_ready, use_page

from ..helper_browser import LayerControlBrowserBase

LIST_ROW = ".foliplus-layer-item"
TOGGLE_ROW = ".foliplus-layer-toggle-all"
STYLE_PANEL = ".foliplus-layer-style-panel"


def polygon_layer() -> folium.GeoJson:
    """One polygon overlay carrying a numeric property, so VALUE fill is offered.

    A single overlay row keeps the first row the polygon everywhere the test
    clicks: the style drawer's fill rows (mode select, scheme trigger) only
    exist on a fill-capable row.
    """
    return folium.GeoJson(
        json.dumps(load_geojson("common", "polygons_fuzhou_3offset")),
        name="Polygon data",
    )


def read_row(page, selector: str, root: str | None = None) -> dict:
    """Computed metrics of one row, read through the shared support snippet."""
    result = page.evaluate(_js("_row_metrics"), {"selector": selector, "root": root})
    assert result.get("ok"), f"{selector}: {result}"
    return result


def open_expanded_panel(page) -> None:
    """Expand the control and wait for its init pass."""
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached", timeout=5000
    )
    panel_ready(page)


def open_style_drawer(page) -> None:
    """Open ⋮ -> Style on the overlay row and wait for the drawer to paint."""
    opened = page.evaluate(_js("LayerControl/open_style_panel"))
    assert opened["ok"], f"style panel did not open: {opened}"
    page.wait_for_selector(STYLE_PANEL, state="visible", timeout=5000)


class TestListRowHeightBrowser(LayerControlBrowserBase):
    """Layer rows and form rows resolve to their own family heights."""

    @pytest.mark.browser
    def test_list_rows_share_one_height(self, browser, tmp_path):
        with use_page(self._make_page, browser, tmp_path, polygon_layer()) as (
            page,
            errors,
        ):
            open_expanded_panel(page)

            # A data row and its role header are the same list-row family.
            layer_row = read_row(page, LIST_ROW)
            assert layer_row["minHeight"] == layer_row["listRowToken"], (
                "layer row does not resolve to --foliplus-row-min-height: "
                f"{layer_row['minHeight']} != {layer_row['listRowToken']}"
            )
            assert layer_row["listRowToken"] == "35.6px", (
                f"list-row token drifted: {layer_row['listRowToken']}"
            )
            toggle_row = read_row(page, TOGGLE_ROW)
            assert toggle_row["minHeight"] == toggle_row["listRowToken"]

            # The horizontal insets stay derived, not repeated: the right inset
            # is the shared base minus the border compensation, the left one is
            # the rail's base step.
            assert layer_row["paddingRight"] == layer_row["layerPadToken"], (
                "layer row right inset is not --foliplus-layer-item-pad-x: "
                f"{layer_row['paddingRight']} != {layer_row['layerPadToken']}"
            )
            assert layer_row["paddingLeft"] == layer_row["spaceSmToken"]

            # A panel header is chrome, not a row: it keeps the control height.
            header = read_row(page, ".foliplus-panel-header")
            assert header["height"] == header["ctrlSizeToken"], (
                "panel header is not --foliplus-ctrl-size: "
                f"{header['height']} != {header['ctrlSizeToken']}"
            )

            # A form row is a control row: it keeps --foliplus-toggle-size.
            open_style_drawer(page)
            page.wait_for_selector(
                f"{STYLE_PANEL} .foliplus-form-row", state="visible", timeout=5000
            )
            form_row = read_row(page, ".foliplus-form-row")
            assert form_row["minHeight"] == form_row["toggleSizeToken"], (
                "form row is not --foliplus-toggle-size: "
                f"{form_row['minHeight']} != {form_row['toggleSizeToken']}"
            )

            assert not errors, f"JS errors: {errors}"


class TestMenuRowHeightBrowser(LayerControlBrowserBase):
    """The overflow menu, the dropdown list and the scheme list are one family."""

    @pytest.mark.browser
    def test_menu_rows_share_one_height(self, browser, tmp_path):
        with use_page(self._make_page, browser, tmp_path, polygon_layer()) as (
            page,
            errors,
        ):
            open_expanded_panel(page)

            # More-menu button: the overflow menu's action rows.
            page.evaluate(_js("LayerControl/click_first_row_more_btn"), LIST_ROW)
            page.wait_for_selector(
                ".foliplus-layer-more-menu.open", state="attached", timeout=5000
            )
            menu_button = read_row(page, ".foliplus-layer-more-menu button")
            # The action menu is deliberately NOT an option row: it stays
            # tighter than the menu-row family height, driven by its padding.
            assert menu_button["minHeight"] < menu_button["menuRowToken"], (
                "more-menu button must stay tighter than --foliplus-menu-row-h: "
                f"{menu_button['minHeight']} >= {menu_button['menuRowToken']}"
            )
            page.keyboard.press("Escape")
            page.wait_for_timeout(50)

            # Dropdown option: the style drawer's bridged select list.
            open_style_drawer(page)
            trigger = page.wait_for_selector(
                f"{STYLE_PANEL} .foliplus-dropdown-trigger", timeout=5000
            )
            trigger.click()
            page.wait_for_selector(
                ".foliplus-dropdown-option", state="visible", timeout=5000
            )
            option = read_row(page, ".foliplus-dropdown-option")
            assert option["minHeight"] == option["menuRowToken"], (
                "dropdown option is not --foliplus-menu-row-h: "
                f"{option['minHeight']} != {option['menuRowToken']}"
            )
            assert option["boxSizing"] == "border-box"
            page.keyboard.press("Escape")
            page.wait_for_timeout(50)

            # Scheme item: the style drawer's color-scheme list, opened on a real
            # press (the picker binds the document mousedown capture phase).
            prepared = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
            assert prepared.get("ok"), f"the ramp mode did not settle: {prepared}"
            page.mouse.click(prepared["triggerX"], prepared["triggerY"])
            page.wait_for_selector(
                ".foliplus-scheme-picker-portal", state="attached", timeout=3000
            )
            page.wait_for_function(
                _js("platform/wait_scheme_dropdown_settled"), timeout=5000
            )
            item = read_row(page, ".foliplus-scheme-picker-item")
            assert item["height"] == item["menuRowToken"], (
                "scheme item is not --foliplus-menu-row-h: "
                f"{item['height']} != {item['menuRowToken']}"
            )

            assert not errors, f"JS errors: {errors}"
