"""Browser computed-style contract for the row-layout token families.

token.css declares two families, one token each; a row belongs to exactly one:

- **list rows** (--foliplus-row-min-height, 35.6px): layer rows and form rows —
  multi-column content plus interaction controls;
- **menu rows** (--foliplus-menu-row-h, 30px): one clickable option line —
  dropdown option, scheme item, search result, more-menu button.

The assertions compare each row's computed height with the computed value of
its family token, so a future row that declares a private height (or a token
that drifts off its family) turns the test red without hardcoded pixels. The
rows outside the families are pinned too: the panel header keeps
--foliplus-ctrl-size and a form row keeps --foliplus-toggle-size (it is a
control row, not a list row).
"""

from __future__ import annotations

import pytest
from conftest import _js, panel_ready, use_page

from ..helper_browser import LayerControlBrowserBase
from ..helper_paint import build_layers


def read_row(page, selector: str, root: str | None = None) -> dict:
    """Computed metrics of one row, read through the shared support snippet."""
    result = page.evaluate(_js("_row_metrics"), {"selector": selector, "root": root})
    assert result.get("ok"), f"{selector}: {result}"
    return result


def open_expanded_panel(page) -> None:
    """Open the control and wait for the row list to render."""
    panel_ready(page)
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached", timeout=5000
    )


class TestListRowHeightBrowser(LayerControlBrowserBase):
    """Layer rows and form rows resolve to the shared list-row height."""

    @pytest.mark.browser
    def test_list_rows_share_one_height(self, browser, tmp_path):
        # The polygon row renders first so the style drawer offers the fill
        # rows this test samples (a point row has no fill row).
        point, line, polygon = build_layers()
        with use_page(self._make_page, browser, tmp_path, polygon, line, point) as (
            page,
            errors,
        ):
            open_expanded_panel(page)

            # A data row and its role header are the same list-row family.
            layer_row = read_row(page, ".foliplus-layer-item")
            assert layer_row["minHeight"] == layer_row["listRowToken"], (
                "layer row does not resolve to --foliplus-row-min-height: "
                f"{layer_row['minHeight']} != {layer_row['listRowToken']}"
            )
            assert layer_row["listRowToken"] == "35.6px", (
                f"list-row token drifted: {layer_row['listRowToken']}"
            )
            toggle_row = read_row(page, ".foliplus-layer-toggle-all")
            assert toggle_row["minHeight"] == toggle_row["listRowToken"]

            # The horizontal insets stay the layer row's own derivation: the
            # right inset is the shared base minus the border compensation, the
            # left one is the rail's base step.
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
            assert page.evaluate(_js("LayerControl/open_style_panel"))["ok"]
            page.wait_for_selector(
                ".foliplus-layer-style-panel .foliplus-form-row", timeout=5000
            )
            form_row = read_row(page, ".foliplus-form-row")
            assert form_row["minHeight"] == form_row["toggleSizeToken"], (
                "form row is not --foliplus-toggle-size: "
                f"{form_row['minHeight']} != {form_row['toggleSizeToken']}"
            )

            assert not errors, f"JS errors: {errors}"


class TestMenuRowHeightBrowser(LayerControlBrowserBase):
    """Every menu row resolves to the shared menu-row height."""

    @pytest.mark.browser
    def test_menu_rows_share_one_height(self, browser, tmp_path):
        # The polygon row renders first so the style drawer offers the fill
        # rows this test samples (a point row has no fill row).
        point, line, polygon = build_layers()
        with use_page(self._make_page, browser, tmp_path, polygon, line, point) as (
            page,
            errors,
        ):
            open_expanded_panel(page)

            # More-menu button: the overflow menu's action rows.
            page.evaluate(
                _js("LayerControl/click_first_row_more_btn"),
                ".foliplus-layer-item",
            )
            page.wait_for_selector(".foliplus-layer-more-menu", timeout=5000)
            menu_button = read_row(page, ".foliplus-layer-more-menu button")
            assert menu_button["minHeight"] == menu_button["menuRowToken"], (
                "more-menu button is not --foliplus-menu-row-h: "
                f"{menu_button['minHeight']} != {menu_button['menuRowToken']}"
            )
            assert menu_button["boxSizing"] == "border-box"
            page.keyboard.press("Escape")
            page.wait_for_timeout(100)

            # Dropdown option: the style drawer's bridged select list.
            assert page.evaluate(_js("LayerControl/open_style_panel"))["ok"]
            trigger = page.wait_for_selector(
                ".foliplus-layer-style-panel .foliplus-dropdown-trigger",
                timeout=5000,
            )
            trigger.click()
            page.wait_for_selector(".foliplus-dropdown-option", timeout=5000)
            option = read_row(page, ".foliplus-dropdown-option")
            assert option["minHeight"] == option["menuRowToken"], (
                "dropdown option is not --foliplus-menu-row-h: "
                f"{option['minHeight']} != {option['menuRowToken']}"
            )
            assert option["boxSizing"] == "border-box"
            page.keyboard.press("Escape")
            page.wait_for_timeout(100)

            # Scheme item: the style drawer's color-scheme list.
            prep = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
            assert prep.get("ok"), prep
            page.mouse.click(prep["triggerX"], prep["triggerY"])
            page.wait_for_selector(".foliplus-scheme-picker-item", timeout=5000)
            item = read_row(page, ".foliplus-scheme-picker-item")
            assert item["height"] == item["menuRowToken"], (
                "scheme item is not --foliplus-menu-row-h: "
                f"{item['height']} != {item['menuRowToken']}"
            )

            assert not errors, f"JS errors: {errors}"
