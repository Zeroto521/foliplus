// LayerControl UI — Overflow (⋮) menu.
import { dom } from "#common/dom.js";
import * as Icons from "#common/icon.js";
import * as CONST from "../const.js";
import * as SVGs from "../icon.js";
import { isFocusLayerDisabled } from "./focus.js";
import type { LayerUI } from "./index.js";
import { finishRename } from "./rename.js";
import { layerHasLabelFields } from "./style.js";

/**
 * Open the "more" overflow dropdown for a given layer row.
 * Every layer (data + base) has this button; it exposes focus + rename.
 *
 * Order is deliberate, not append order:
 *
 *   1. Focus      — a view action on the map: nothing written, highest use, and
 *                   it has its own Escape-cancel path.
 *   2. Style      — opens the layer's style panel.
 *   3. Rename     — writes to the layer itself; the only entry that hands focus
 *                   to a long-lived inline editor.
 *   4. Attributes — opens the read-only detail panel. Display-only, never
 *                   disabled, so it closes the list as the quiet tail.
 *
 * Focus leads because the trigger-adjacent slot is the mis-click zone: the menu
 * opens downward from the row's bottom edge (`top: 100%`) while the ⋮ button is
 * vertically centred in the row, so when the menu appears the pointer is *above
 * its top edge* — nearest entry #1. The second click of an impatient
 * double-click lands there, so it holds the reversible view action.
 *
 * Known cost: the menu lives inside the panel's scrolling content, so it
 * overflows that box by a few px on a low row. The trailing entry is the first
 * to need a scroll — measured, not assumed; see the ⋮-menu clip probe.
 *
 * A new dimensions entry belongs with Style, not at the tail.
 */
const openMoreMenu = (ui: LayerUI, item: HTMLElement) => {
  // Close any previously open menu first, and commit/cancel a rename so
  // the label text is fresh before we read the row.
  finishRename(ui);
  closeMoreMenu(ui, true);

  const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
  const menu = dom.el("ul", { class: "foliplus-layer-more-menu open", role: "menu" });
  // Focus-layer is disabled for basemaps (no useful extent) and hidden rows.
  // The disabled li carries cursor: not-allowed (common menu CSS).
  const focusDisabled = isFocusLayerDisabled(ui, item);

  const itemAttrs = {
    "data-action": "focus-layer",
    role: "menuitem",
    tabindex: "0",
    title: focusDisabled ? ui.T("focus_layer_hidden") : ui.T("focus_layer_tooltip"),
    "aria-disabled": focusDisabled ? "true" : "false",
  };

  menu.appendChild(dom.el("li", itemAttrs, { html: SVGs.FOCUS }, ui.T("focus_layer")));

  if (focusDisabled) menu.lastElementChild!.setAttribute("disabled", "disabled");

  // The Style menu entry is the surface for the per-layer style panel — the
  // current implementation only ships the "labels" dimension, but the same
  // entry will host future style dimensions (color, opacity, …). Disable it
  // exactly like focus-layer when there is nothing to configure.
  const styleDisabled = focusDisabled || !layerHasLabelFields(ui, layerId);

  menu.appendChild(
    dom.el(
      "li",
      {
        "data-action": CONST.ACTION.STYLE_LAYER,
        role: "menuitem",
        tabindex: "0",
        title: styleDisabled
          ? ui.T("style_label_no_data")
          : ui.T("style_layer_tooltip"),
        "aria-disabled": styleDisabled ? "true" : "false",
      },
      { html: SVGs.STYLE },
      ui.T("style_layer"),
    ),
  );
  if (styleDisabled) menu.lastElementChild!.setAttribute("disabled", "disabled");

  // Rename writes to the layer itself, so it sits above the display-only
  // entry rather than at the tail of the working actions.
  menu.appendChild(
    dom.el(
      "li",
      {
        "data-action": CONST.ACTION.RENAME_LAYER,
        role: "menuitem",
        tabindex: "0",
        title: ui.T("rename_layer_tooltip"),
      },
      { html: Icons.EDIT },
      ui.T("rename_layer"),
    ),
  );

  // Attributes is display-only, so it is never disabled —a hidden layer
  // still has name / source / visibility to show. It closes the list.
  menu.appendChild(
    dom.el(
      "li",
      {
        "data-action": CONST.ACTION.ATTRS_LAYER,
        role: "menuitem",
        tabindex: "0",
        title: ui.T("attributes_layer_tooltip"),
      },
      { html: Icons.INFO },
      ui.T("attributes_layer"),
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

export { openMoreMenu, closeMoreMenu };
