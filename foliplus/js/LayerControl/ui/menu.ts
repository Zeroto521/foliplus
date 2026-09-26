// LayerControl UI — Overflow (⋮) menu.
import { dom } from "#common/dom.js";
import * as Icons from "#common/icon.js";
import * as CONST from "../const.js";
import * as SVGs from "../icon.js";
import { focusDisabledLocaleKey, focusDisabledReason } from "./focus.js";
import type { LayerUI } from "./index.js";
import { finishRename } from "./rename.js";
import { layerHasLabelFields, layerHasStyleDelegation } from "./style/index.js";

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
 *                   disabled, so it closes the quiet part of the list.
 *   5. Delete     — behind a divider, the one destructive entry. Armed in
 *                   place on the first click and executed on the second; it is
 *                   rendered only for rows that own a Leaflet layer (data
 *                   layers, tile basemaps included), the solid colour basemap
 *                   renders it disabled, and a component layer renders nothing.
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
  // Focus-layer is disabled for basemaps (no useful extent), hidden rows, and
  // layers whose surface reports no bounds carrier. The disabled li carries
  // cursor: not-allowed (common menu CSS) and the reason as its tooltip.
  const focusReason = focusDisabledReason(ui, item);
  const focusDisabled = focusReason !== undefined;
  const focusDisabledTitle =
    focusReason !== undefined
      ? ui.T(focusDisabledLocaleKey(focusReason))
      : ui.T("focus_layer_tooltip");

  const itemAttrs = {
    "data-action": "focus-layer",
    role: "menuitem",
    tabindex: "0",
    title: focusDisabled ? focusDisabledTitle : ui.T("focus_layer_tooltip"),
    "aria-disabled": focusDisabled ? "true" : "false",
  };

  menu.appendChild(dom.el("li", itemAttrs, { html: SVGs.FOCUS }, ui.T("focus_layer")));

  if (focusDisabled) menu.lastElementChild!.setAttribute("disabled", "disabled");

  // The Style menu entry is the surface for the per-layer style panel — the
  // current implementation only ships the "labels" dimension, but the same
  // entry will host future style dimensions (color, opacity, …). Disable it
  // exactly like focus-layer when there is nothing to configure.
  //
  // R5: capability-driven gate. A layer whose surface reports opacity and
  // zoomRange as "none" (e.g. MarkerCluster) cannot be styled for those
  // dimensions, so the panel is disabled unless it still has label fields or
  // style delegation to configure.
  //
  // `focusReason` cascades into `styleDisabled` only for the reasons that
  // make styling impossible: a hidden row has nothing visible to style.
  // A "no_bounds" row is still visible and configurable — it simply has no
  // geographic extent to focus on — so it keeps its style entry enabled.
  // Basemaps are configurable too: the solid-color basemap has a fill row
  // in its style panel, and tile basemaps can still tune opacity.
  const layerInfo = ui.m.layerRegistry.get(layerId);
  const caps = layerInfo ? ui.m.surfaceFor(layerInfo).capabilities : null;
  const canConfigure =
    (caps && (caps.opacity !== "none" || caps.zoomRange !== "none")) ||
    layerHasLabelFields(ui, layerId) ||
    layerHasStyleDelegation(ui, layerId);
  const styleDisabled = focusReason === "hidden" || !canConfigure;

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
      { html: Icons.EDIT_ICON },
      ui.T("rename_layer"),
    ),
  );

  // Attributes is display-only, so it is never disabled —a hidden layer
  // still has name / source / visibility to show.
  menu.appendChild(
    dom.el(
      "li",
      {
        "data-action": CONST.ACTION.ATTRS_LAYER,
        role: "menuitem",
        tabindex: "0",
        title: ui.T("attributes_layer_tooltip"),
      },
      { html: Icons.INFO_ICON },
      ui.T("attributes_layer"),
    ),
  );

  // Delete goes behind a divider: everything above it is reversible (view,
  // configure, rename, inspect), and this is the only entry that is not. The
  // criterion is the row's shape, not something the caller declares — a row
  // that owns a Leaflet layer is a data layer and can be deleted, tile
  // basemaps included, since deleting every base layer down to the default
  // grey background is a legal end state. A component layer (no layer of its
  // own: the heatmap and measure canvases) renders nothing here; its
  // "restore defaults" verb is a different action and lands separately. The
  // one exception is the solid colour basemap, which renders the entry
  // disabled: hiding it would read as "the feature does not exist".
  const deleteMode = deleteModeFor(ui, layerId);
  if (deleteMode !== "absent") {
    menu.appendChild(
      dom.el("li", {
        class: `${CONST.CLASSES.MENU_DIVIDER} foliplus-section-divider`,
        role: "separator",
        "aria-hidden": "true",
      }),
    );
    menu.appendChild(buildDeleteItem(ui, deleteMode));
  }

  item.style.position = "relative";
  item.appendChild(menu);

  // Tab moving focus out of the menu dismisses it — an open menu owns the
  // keyboard cursor (ARIA menu pattern). Focus wandering within the menu,
  // or onto the anchor row itself (jsdom falls a disabled-item click back
  // to the row, and a real Tab can land on the row's own controls), keeps
  // the menu open. The listener lives on the menu element, so it dies with
  // the menu on close. Click-outside and Escape close through their own
  // paths, and this re-closing is a no-op then (activeMenu is already gone).
  menu.addEventListener("focusout", event => {
    const next = (event as FocusEvent).relatedTarget as Node | null;
    if (next && (next === item || item.contains(next))) return;
    if (!next || !menu.contains(next)) closeMoreMenu(ui, false);
  });

  ui.activeMenu = { item, menu, layerId };

  // Focus the first menu item so Enter/Space activate it and Escape closes.
  const firstItem = menu.querySelector(".foliplus-layer-more-menu li") as HTMLElement;
  if (firstItem) firstItem.focus();
};

/** Why the ⋮ menu shows a delete entry for `item`. `absent` means render
 *  nothing — see the comment at the call site for why a component layer is
 *  not "disabled delete". */
type DeleteMode = "available" | "disabled" | "absent";

/** How long an armed delete entry waits for its confirming click. Anything
 *  that closes the menu disarms it anyway, so this only covers the case where
 *  the entry stays focused and forgotten. */
const DELETE_ARMED_TIMEOUT_MS = 3000;

/** The one armed delete entry, if any: only one menu is open at a time, so a
 *  module-level pointer cannot refer to two rows at once. */
let armedDelete: { ui: LayerUI; label: HTMLElement; li: HTMLElement } | null = null;
let armedDeleteTimer: ReturnType<typeof setTimeout> | undefined;

const deleteModeFor = (ui: LayerUI, layerId: string): DeleteMode => {
  if (!layerId) return "absent";
  if (layerId === CONST.COLOR.MAP_ID) return "disabled";
  // `findLayer`, not `registry.get(id).layer`: folium registers its own layers
  // by id only, so the entry's `layer` stays null until something resolves it.
  // Testing the field would read every layer on a real folium map as a component
  // layer and render no delete entry at all. `findLayer` walks the map's own
  // layer registry to find the object.
  return ui.m.findLayer(layerId) ? "available" : "absent";
};

const buildDeleteItem = (
  ui: LayerUI,
  mode: Exclude<DeleteMode, "absent">,
): HTMLElement => {
  const disabled = mode === "disabled";
  const label = dom.el(
    "span",
    { class: CONST.CLASSES.MENU_DELETE_LABEL },
    ui.T("delete_layer"),
  );
  const item = dom.el(
    "li",
    {
      "data-action": CONST.ACTION.DELETE_LAYER,
      role: "menuitem",
      tabindex: "0",
      title: disabled ? ui.T("delete_layer_disabled") : ui.T("delete_layer_tooltip"),
      "aria-disabled": disabled ? "true" : "false",
    },
    { html: Icons.DELETE_ICON },
    label,
  );
  if (disabled) item.setAttribute("disabled", "disabled");
  return item;
};

/** Turn the delete entry into its confirming state: the label swaps to the
 *  confirmation text and the entry fills, so the second click is unambiguous
 *  without borrowing the accent colour (which already means hover and focus). */
const armDelete = (ui: LayerUI, li: HTMLElement): void => {
  const label = li.querySelector<HTMLElement>(`.${CONST.CLASSES.MENU_DELETE_LABEL}`);
  if (!label) return;
  disarmDelete();
  armedDelete = { ui, label, li };
  label.textContent = ui.T("delete_layer_confirm");
  li.classList.add(CONST.CLASSES.MENU_DELETE_ARMED);
  li.setAttribute("title", ui.T("delete_layer_confirm"));
  armedDeleteTimer = setTimeout(disarmDelete, DELETE_ARMED_TIMEOUT_MS);
};

/** Back out of the confirming state. Idempotent, and called on every path that
 *  closes the menu so an abandoned attempt never leaves an armed entry behind. */
const disarmDelete = (): void => {
  if (armedDeleteTimer) clearTimeout(armedDeleteTimer);
  armedDeleteTimer = undefined;
  const armed = armedDelete;
  if (!armed) return;
  armed.label.textContent = armed.ui.T("delete_layer");
  armed.li.classList.remove(CONST.CLASSES.MENU_DELETE_ARMED);
  armedDelete = null;
};

/** The two-step delete, shared by the click and the keyboard path. Returns
 *  true when the delete fired and the menu should close; false means the entry
 *  was only armed, so the menu stays open and the user sees what they are about
 *  to confirm. */
const activateDeleteItem = (ui: LayerUI, li: HTMLElement): boolean => {
  if (!li.classList.contains(CONST.CLASSES.MENU_DELETE_ARMED)) {
    armDelete(ui, li);
    return false;
  }
  const layerId = ui.activeMenu?.layerId ?? "";
  disarmDelete();
  ui.m.deleteLayer(layerId);
  return true;
};

/** Close the overflow menu. setFocus = true returns focus to the layer row. */

const closeMoreMenu = (ui: LayerUI, setFocus: boolean) => {
  if (!ui.activeMenu) return;
  const item = ui.activeMenu.item;
  const menu = ui.activeMenu.menu;
  // Clear the pointer before removing: the removal can trigger the menu's own
  // focusout, which calls closeMoreMenu again — that re-entrant pass must see
  // null, not call remove() on a detached menu (NotFoundError).
  ui.activeMenu = null;
  disarmDelete();
  menu.remove();
  if (setFocus) item.focus();
};

export { activateDeleteItem, closeMoreMenu, openMoreMenu };
