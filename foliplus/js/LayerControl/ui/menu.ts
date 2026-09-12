// LayerControl UI 鈥?Overflow (鈰? menu.
import { dom } from "#common/dom.js";
import * as Icons from "#common/icon.js";
import * as CONST from "../const.js";
import * as SVGs from "../icon.js";
import type { LayerUI } from "./index.js";
import { T } from "./context.js";

/**
 * Open the "more" overflow dropdown for a given layer row.
 * Every layer (data + base) has this button; it exposes focus + rename.
 */
const openMoreMenu = (ui: LayerUI, item: HTMLElement) => {
  // Close any previously open menu first, and commit/cancel a rename so
  // the label text is fresh before we read the row.
  ui.finishRename();
  ui.closeMoreMenu(true);

  const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
  const menu = dom.el("ul", { class: "foliplus-layer-more-menu open", role: "menu" });
  // Focus-layer is disabled for basemaps (no useful extent) and hidden rows.
  // The disabled li carries cursor: not-allowed (common menu CSS).
  const focusDisabled = ui.isFocusLayerDisabled(item);

  const itemAttrs = {
    "data-action": "focus-layer",
    role: "menuitem",
    tabindex: "0",
    title: focusDisabled ? T("focus_layer_hidden") : T("focus_layer_tooltip"),
    "aria-disabled": focusDisabled ? "true" : "false",
  };

  menu.appendChild(dom.el("li", itemAttrs, { html: SVGs.FOCUS }, T("focus_layer")));

  if (focusDisabled) menu.lastElementChild!.setAttribute("disabled", "disabled");

  menu.appendChild(
    dom.el(
      "li",
      {
        "data-action": CONST.ACTION.RENAME_LAYER,
        role: "menuitem",
        tabindex: "0",
        title: T("rename_layer_tooltip"),
      },
      { html: Icons.EDIT },
      T("rename_layer"),
    ),
  );

  // Attributes is display-only, so it is never disabled 鈥?a hidden layer
  // still has name / source / visibility to show.
  menu.appendChild(
    dom.el(
      "li",
      {
        "data-action": CONST.ACTION.ATTRS_LAYER,
        role: "menuitem",
        tabindex: "0",
        title: T("attributes_layer_tooltip"),
      },
      { html: Icons.INFO },
      T("attributes_layer"),
    ),
  );

  item.style.position = "relative";
  item.appendChild(menu);

  ui.activeMenu = { item, menu, layerId };

  // Focus the first menu item so Enter/Space activate it and Escape closes.
  const firstItem = menu.querySelector(".foliplus-layer-more-menu li") as HTMLElement;
  if (firstItem) firstItem.focus();
};

/** Close the overflow menu. setFocus = true returns focus to the layer row. */

const closeMoreMenu = (ui: LayerUI, setFocus: boolean) => {
  if (!ui.activeMenu) return;
  const item = ui.activeMenu.item;
  ui.activeMenu.menu.remove();
  ui.activeMenu = null;
  if (setFocus) item.focus();
};

/**
 * Open the attributes panel for a given layer row: display-only metadata
 * (name, provenance, feature count, last update, visibility) plus any
 * third-party `meta` entries passed to registerLayer.
 *
 * Rows are omitted when they carry no value 鈥?a panel is not padded with
 * "鈥?. The color basemap is included (it carries no provider data, but the
 * fixed rows still read).
 */

export {
  openMoreMenu,
  closeMoreMenu,
};
