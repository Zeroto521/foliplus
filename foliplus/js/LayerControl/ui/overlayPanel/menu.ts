// LayerControl UI — Overflow (⋮) menu.
import { HINT_DURATION } from "#core/hint.js";
import { CAP_TIER } from "#core/layer/index.js";
import { OVERLAY_IDS, ensureOverlayRegistry } from "#core/overlayRegistry.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import * as SVGs from "#foliplus/LayerControl/icon.js";
import { dom } from "#common/dom.js";
import * as Icons from "#common/icon.js";
import { focusDisabledLocaleKey, focusDisabledReason } from "../focus/index.js";
import { layerCanLabel, layerHasStyleDelegation } from "../style/index.js";
import type { LayerUI } from "../surface.js";
import { closeOverlays } from "../teardown.js";
import { isFilterCapable } from "./filter.js";

/**
 * Open the "more" overflow dropdown for a given layer row.
 * Every layer (data + base) has this button; it exposes focus + rename.
 *
 * Order is deliberate, not append order:
 *
 *   1. Filter     — the primary data action on a capability row; RENDERED
 *                   ONLY when the row declares the filter capability. An
 *                   unsupported layer gets no entry at all (not a disabled
 *                   one): a control that can never run is noise.
 *   2. Style      — opens the layer's style panel.
 *   3. Focus      — a view action on the map: nothing written.
 *   4. Rename     — writes to the layer itself; the only entry that hands focus
 *                   to a long-lived inline editor.
 *   5. Attributes — opens the read-only detail panel. Display-only, never
 *                   disabled, so it closes the quiet part of the list.
 *   6. Delete     — behind a divider, the one destructive entry. Armed in
 *                   place on the first click and executed on the second; it is
 *                   rendered for every layer. The label varies by semantics:
 *                   "Delete Layer" for user-owned data layers, "Clear Data"
 *                   for component-owned layers.
 *
 * The trigger-adjacent slot is the mis-click zone: the menu opens downward from
 * the row's bottom edge (`top: 100%`) while the ⋮ button is vertically centered,
 * so when the menu appears the pointer is *above* its top edge — nearest entry
 * #1. Filter/Style lead because a double-click there is still recoverable (both
 * are reversible), never the destructive tail.
 *
 * Known cost: the menu lives inside the panel's scrolling content, so it
 * overflows that box by a few px on a low row. The trailing entry is the first
 * to need a scroll — measured, not assumed; see the ⋮-menu clip probe.
 *
 * A new dimensions entry belongs with Style, not at the tail.
 */
/** Click handler for the overflow menu items. The action itself is dispatched
 *  by the menu's shared runner, so a click and a keyboard activation of the
 *  same entry cannot diverge. Outside-click dismissal is the overlay
 *  registry's LAYER_MENU entry, not this handler.
 *
 *  The press stops here: an action may close the menu (opening a panel tears it
 *  down), and the browser keeps dispatching the click along the path it
 *  computed before the target was detached. Leaflet decides whether a click
 *  belongs to the map by walking the target's *live* parents up to its
 *  container (`_isClickDisabled`); a detached target has no control ancestor
 *  left to find the `_leaflet_disable_click` marker on, so the press would land
 *  on the map as a real click — e.g. it drops a marker while a MeasureControl
 *  mode is armed. Swallowing it here keeps the "a click inside the control is
 *  not a map click" guarantee that `disableClickPropagation` gave us while the
 *  menu sat in the document. */
const handleMenuClick = (ui: LayerUI, event: Event): void => {
  const target = event.target as HTMLElement;
  const menuItem = target.closest(
    `.foliplus-layer-more-menu button`,
  ) as HTMLElement | null;
  if (!menuItem) return;
  event.stopPropagation();
  // A disabled entry keeps the menu open so the user sees why (its tooltip
  // carries the reason); the shared runner applies that rule for both inputs.
  // A native button fires its click from Enter/Space with `detail === 0` (the
  // keyboard-originated marker), so the disabled reason is surfaced as a hint
  // only for a keyboard user — a mouse click on a disabled entry stays silent
  // (its tooltip already explains it), preserving the old input split.
  runMenuAction(ui, menuItem, {
    explainDisabled: (event as MouseEvent).detail === 0,
  });
};

const openMoreMenu = (ui: LayerUI, item: HTMLElement) => {
  // Tear down the competing overlays first. The rename teardown in
  // particular keeps the row's label text fresh before we read it below.
  closeOverlays(ui);

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

  // Filter leads when the row declares the capability. Unsupported rows get
  // NO entry: a permanently disabled control is noise; a new capability only
  // adds its own gate without changing this rule.
  const filterSupported = layerSupportsFilter(ui, layerId);
  if (filterSupported) {
    menu.appendChild(
      dom.el(
        "button",
        {
          type: "button",
          "data-action": CONST.ACTION.FILTER_LAYER,
          role: "menuitem",
          title: ui.T("filter_layer_tooltip"),
          "aria-disabled": "false",
        },
        { html: SVGs.ICON_FILTER },
        ui.T("filter_layer"),
      ),
    );
  }

  // The Style menu entry is the surface for the per-layer style panel — the
  // current implementation only ships the "labels" dimension, but the same
  // entry will host future style dimensions (color, opacity, …). Disable it
  // exactly like focus-layer when there is nothing to configure.
  //
  // Capability-driven gate. A layer whose surface reports opacity and
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
  const layerInfo = ui.c.layerRegistry.get(layerId);
  const caps = layerInfo ? ui.c.surfaceFor(layerInfo).capabilities : null;
  // `layerCanLabel` is the Label section's gate itself (pure capability
  // bit) — the menu and the panel ask one function, so the entry can never
  // enable a panel whose Label section would not render (or vice versa).
  const canConfigure =
    (caps && (caps.opacity !== CAP_TIER.NONE || caps.zoomRange !== CAP_TIER.NONE)) || // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- left side can be false
    layerCanLabel(ui, layerId) ||
    layerHasStyleDelegation(ui, layerId);
  const styleDisabled = focusReason === "hidden" || !canConfigure;

  menu.appendChild(
    dom.el(
      "button",
      {
        type: "button",
        "data-action": CONST.ACTION.STYLE_LAYER,
        role: "menuitem",
        title: styleDisabled
          ? ui.T("style_label_no_data")
          : ui.T("style_layer_tooltip"),
        "aria-disabled": styleDisabled ? "true" : "false",
      },
      { html: SVGs.ICON_STYLE },
      ui.T("style_layer"),
    ),
  );

  // Focus follows Style: the reversible view action keeps a fixed, safe slot
  // just after the configure action instead of opening the menu (a double-
  // click on the trigger must never land on the destructive tail).
  const itemAttrs = {
    type: "button",
    "data-action": "focus-layer",
    role: "menuitem",
    title: focusDisabled ? focusDisabledTitle : ui.T("focus_layer_tooltip"),
    "aria-disabled": focusDisabled ? "true" : "false",
  };

  menu.appendChild(
    dom.el("button", itemAttrs, { html: SVGs.ICON_FOCUS }, ui.T("focus_layer")),
  );

  // Rename writes to the layer itself, so it sits above the display-only
  // entry rather than at the tail of the working actions.
  menu.appendChild(
    dom.el(
      "button",
      {
        type: "button",
        "data-action": CONST.ACTION.RENAME_LAYER,
        role: "menuitem",
        title: ui.T("rename_layer_tooltip"),
      },
      { html: Icons.ICON_EDIT },
      ui.T("rename_layer"),
    ),
  );

  // Attributes is display-only, so it is never disabled — a hidden layer
  // still has name / source / visibility to show.
  menu.appendChild(
    dom.el(
      "button",
      {
        type: "button",
        "data-action": CONST.ACTION.ATTRS_LAYER,
        role: "menuitem",
        title: ui.T("attributes_layer_tooltip"),
      },
      { html: Icons.ICON_INFO },
      ui.T("attributes_layer"),
    ),
  );

  // Delete goes behind a divider: everything above it is reversible (view,
  // configure, rename, inspect), and this is the only entry that is not. Three
  // modes share the entry: user-owned data layers (retire the id for good,
  // tile basemaps included — dropping to a bare background is a legal end
  // state), component-owned layers (Measure, Heatmap: clear their data through
  // LAYER_DELETED, id stays registerable), and the solid color basemap (clear
  // the fill and return to the grid empty state). The label and tooltip vary
  // by mode — "Delete Layer" for real deletion, "Clear Data" for component
  // clear — so the action name matches the effect.
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
  // Menu item actions are dispatched locally: the old document-level click
  // delegate was the only reason the menu needed a document listener.
  menu.addEventListener("click", event => handleMenuClick(ui, event));

  ui.overlayPanel.activeMenu = { item, menu, layerId };
  ui.overlayPanel.menuOverlayUnregister = ensureOverlayRegistry(ui.c.map).register({
    id: OVERLAY_IDS.LAYER_MENU,
    isOpen: () => ui.overlayPanel.activeMenu !== null,
    panels: () => {
      const active = ui.overlayPanel.activeMenu;
      return active ? [active.menu] : [];
    },
    close: ({ restoreFocus }) => closeMoreMenu(ui, restoreFocus),
    dismissOn: "click",
    pressPriority: 800,
    clearsCursorOnClose: true,
  });

  // Focus the first menu item so Enter/Space activate it and Escape closes.
  // The head is Filter when supported, Style otherwise — both are reversible
  // actions, so the trigger-adjacent slot is always safe.
  (
    menu.querySelector<HTMLElement>(".foliplus-layer-more-menu button") as HTMLElement
  ).focus();
};

/** Why the ⋮ menu shows a delete/clear entry for `item`. `absent` means render
 *  nothing — see the comment at the call site for why a component layer is
 *  not "disabled delete". */
type DeleteMode = "clear" | "delete" | "absent";

/** How long an armed delete entry waits for its confirming click. Anything
 *  that closes the menu disarms it anyway, so this only covers the case where
 *  the entry stays focused and forgotten. */
const DELETE_ARMED_TIMEOUT_MS = 3000;

/** The one armed delete entry, if any: only one menu is open at a time, so a
 *  module-level pointer cannot refer to two rows at once. */
let armedDelete: {
  ui: LayerUI;
  label: HTMLElement;
  menuItem: HTMLElement;
  isClear: boolean;
  originalTitle: string;
} | null = null;
let armedDeleteTimer: ReturnType<typeof setTimeout> | undefined;

const deleteModeFor = (ui: LayerUI, layerId: string): DeleteMode => {
  if (!layerId) return "absent";
  // The solid color basemap uses delete semantics (row disappears, id stays
  // registerable so the color can be re-picked) — same as a user data layer.
  if (layerId === CONST.SOLID_BASEMAP_ID) return "delete";
  // Component-owned layers (Measure, Heatmap) clear their data instead of being
  // retired. The id stays registerable so the component can re-draw.
  if (isComponentLayer(ui, layerId)) return "clear";
  // `findLayer`, not `registry.get(id).layer`: folium registers its own layers
  // by id only, so the entry's `layer` stays null until something resolves it.
  // Testing the field would read every layer on a real folium map as a component
  // layer and render no delete entry at all. `findLayer` walks the map's own
  // layer registry to find the object.
  return ui.c.findLayer(layerId) ? "delete" : "absent";
};

/** True when the layer is owned by a foliplus component — Measure, Heatmap
 *  (styleSetters). Matches the discriminator in `LayerController.deleteLayer`, so
 *  the two stay in lockstep. The solid color basemap is handled separately in
 *  `deleteModeFor` and returns "delete" instead of "clear". */
const isComponentLayer = (ui: LayerUI, layerId: string): boolean => {
  return Boolean(ui.c.layerRegistry.get(layerId)?.styleSetters);
};

/** Gate for the ⋮ filter entry. A row is filterable only
 *  when it declares the explicit filter capability (`filterProvider` +
 *  `filterSetter` — the component that owns the row's data, HeatmapControl
 *  today). Never inferred from `styleSetters`: MeasureControl declares
 *  style delegation too and its rows are not filterable. The panel's
 *  reads and writes derive from the same declaration, so the gate, the
 *  panel and the owner cannot drift apart. */
const layerSupportsFilter = (ui: LayerUI, layerId: string): boolean =>
  isFilterCapable(ui.c.layerRegistry.get(layerId));

const buildDeleteItem = (
  ui: LayerUI,
  mode: Exclude<DeleteMode, "absent">,
): HTMLElement => {
  const isClear = mode === "clear";
  const label = dom.el(
    "span",
    { class: CONST.CLASSES.MENU_DELETE_LABEL },
    ui.T(isClear ? "clear_data" : "delete_layer"),
  );
  const tooltip = ui.T(isClear ? "clear_data_tooltip" : "delete_layer_tooltip");
  const item = dom.el(
    "button",
    {
      type: "button",
      "data-action": CONST.ACTION.DELETE_LAYER,
      "data-mode": mode,
      role: "menuitem",
      title: tooltip,
    },
    { html: Icons.ICON_DELETE },
    label,
  );
  return item;
};

/** Turn the delete entry into its confirming state: the label swaps to the
 *  confirmation text and the entry fills, so the second click is unambiguous
 *  without borrowing the accent color (which already means hover and focus). */
const armDelete = (ui: LayerUI, menuItem: HTMLElement): void => {
  const label = menuItem.querySelector<HTMLElement>(
    `.${CONST.CLASSES.MENU_DELETE_LABEL}`,
  );
  if (!label) return;
  disarmDelete();
  const isClear = menuItem.dataset.mode === "clear";
  // The title attribute is set by buildDeleteItem at entry construction, so
  // there is no null to fall back to.
  const originalTitle = menuItem.getAttribute("title")!;
  armedDelete = { ui, label, menuItem, isClear, originalTitle };
  label.textContent = ui.T(isClear ? "clear_data_confirm" : "delete_layer_confirm");
  menuItem.classList.add(CONST.CLASSES.MENU_DELETE_ARMED);
  menuItem.setAttribute(
    "title",
    ui.T(isClear ? "clear_data_confirm" : "delete_layer_confirm"),
  );
  armedDeleteTimer = setTimeout(disarmDelete, DELETE_ARMED_TIMEOUT_MS);
};

/** Back out of the confirming state. Idempotent, and called on every path that
 *  closes the menu so an abandoned attempt never leaves an armed entry behind. */
const disarmDelete = (): void => {
  if (armedDeleteTimer) clearTimeout(armedDeleteTimer);
  armedDeleteTimer = undefined;
  const armed = armedDelete;
  if (!armed) return;
  armed.label.textContent = armed.ui.T(armed.isClear ? "clear_data" : "delete_layer");
  armed.menuItem.setAttribute("title", armed.originalTitle);
  armed.menuItem.classList.remove(CONST.CLASSES.MENU_DELETE_ARMED);
  armedDelete = null;
};

/** The two-step delete, shared by the click and the keyboard path. Returns
 *  true when the delete fired and the menu should close; false means the entry
 *  was only armed, so the menu stays open and the user sees what they are about
 *  to confirm. */
const activateDeleteItem = (ui: LayerUI, menuItem: HTMLElement): boolean => {
  if (!menuItem.classList.contains(CONST.CLASSES.MENU_DELETE_ARMED)) {
    armDelete(ui, menuItem);
    return false;
  }
  const layerId = ui.overlayPanel.activeMenu?.layerId ?? "";
  disarmDelete();
  ui.c.deleteLayer(layerId);
  return true;
};

/** Close the overflow menu. setFocus = true returns focus to the layer row. */

const closeMoreMenu = (ui: LayerUI, setFocus: boolean) => {
  ui.overlayPanel.menuOverlayUnregister?.();
  ui.overlayPanel.menuOverlayUnregister = null;
  if (!ui.overlayPanel.activeMenu) return;
  const item = ui.overlayPanel.activeMenu.item;
  const menu = ui.overlayPanel.activeMenu.menu;
  // Clear the pointer before removing: the removal can trigger the menu's own
  // focusout, which calls closeMoreMenu again — that re-entrant pass must see
  // null, not call remove() on a detached menu (NotFoundError).
  ui.overlayPanel.activeMenu = null;
  disarmDelete();
  menu.remove();
  if (setFocus) item.focus();
};

/** Every action the overflow menu renders, keyed by its `data-action` value. */
type MenuAction = (typeof CONST.ACTION)[keyof typeof CONST.ACTION];

interface MenuActionResult {
  /** Whether the menu closes once the action ran. */
  closeMenu: boolean;
  /** Whether a closing menu returns focus to the layer row. Rename keeps focus
   *  in the inline editor instead: restoring the row would blur the fresh
   *  input and commit the pre-edit value. */
  restoreRowFocus: boolean;
}

/** The row a menu entry acts on. The menu state is the source of truth; an
 *  entry detached from its menu falls back to itself, as it always has for a
 *  click on a menu that lost its state. */
const menuRow = (ui: LayerUI, menuItem: HTMLElement): HTMLElement =>
  ui.overlayPanel.activeMenu?.item ?? menuItem;

/** The layer id the open menu belongs to. */
const menuLayerId = (ui: LayerUI): string => ui.overlayPanel.activeMenu?.layerId ?? "";

/** One dispatch table for every menu action. The click handler and the keyboard
 *  handler both go through `runMenuAction`, so an entry cannot work with one
 *  input and do something else with the other — the two lists used to drift
 *  (keyboard knew three of the six actions and sent the rest to focus-layer).
 *  The `Record<MenuAction, …>` shape makes a new CONST.ACTION value fail
 *  typecheck until its branch exists here. */
const MENU_ACTIONS: Record<
  MenuAction,
  (ui: LayerUI, menuItem: HTMLElement) => MenuActionResult
> = {
  [CONST.ACTION.FILTER_LAYER]: (ui, menuItem) => {
    ui.openFilterPanel(menuRow(ui, menuItem));
    return { closeMenu: true, restoreRowFocus: true };
  },
  [CONST.ACTION.STYLE_LAYER]: ui => {
    ui.openStylePanel(menuLayerId(ui));
    return { closeMenu: true, restoreRowFocus: true };
  },
  [CONST.ACTION.FOCUS_LAYER]: ui => {
    ui.focusLayer(menuLayerId(ui));
    return { closeMenu: true, restoreRowFocus: true };
  },
  [CONST.ACTION.RENAME_LAYER]: ui => {
    ui.renameLayer(menuLayerId(ui));
    return { closeMenu: true, restoreRowFocus: false };
  },
  [CONST.ACTION.ATTRS_LAYER]: (ui, menuItem) => {
    // Anchored to the menu's own row: the menu state is the source of truth
    // for which row owns it, and the entry itself is the fallback.
    ui.openAttrsPanel(menuRow(ui, menuItem));
    return { closeMenu: true, restoreRowFocus: true };
  },
  [CONST.ACTION.DELETE_LAYER]: (ui, menuItem) => {
    // Armed in place: the first activation only arms, so the menu stays open
    // and the confirming label is visible; the second one deletes.
    if (activateDeleteItem(ui, menuItem)) {
      return { closeMenu: true, restoreRowFocus: true };
    }
    return { closeMenu: false, restoreRowFocus: false };
  },
};

/**
 * Run the action a menu entry carries. Shared by the delegated click handler
 * and the keyboard handler (`ArrowLeft/ArrowRight/Space/Enter` on a focused
 * entry): one input-agnostic path, no divergence.
 *
 * `explainDisabled` is the one deliberate input difference: a click on a
 * disabled entry stays silent (its tooltip already explains it), while the
 * keyboard path surfaces that same title as a hint — a keyboard user gets no
 * tooltip hover.
 */
const runMenuAction = (
  ui: LayerUI,
  menuItem: HTMLElement,
  options: { explainDisabled?: boolean } = {},
): void => {
  if (menuItem.getAttribute("aria-disabled") === "true") {
    if (options.explainDisabled) {
      const reason = menuItem.getAttribute("title");
      if (reason) {
        ui.c.map.foliplus!.showHint(ui.config.name, reason, HINT_DURATION.SHORT);
      }
    }
    return;
  }
  const action = menuItem.getAttribute("data-action") ?? "";
  const handler = MENU_ACTIONS[action as MenuAction];
  if (!handler) {
    // Unknown action: close and return focus, matching the old click
    // fallthrough for any entry the table does not know.
    ui.closeMoreMenu(true);
    return;
  }
  const outcome = handler(ui, menuItem);
  if (outcome.closeMenu) ui.closeMoreMenu(outcome.restoreRowFocus);
};

export {
  MENU_ACTIONS,
  activateDeleteItem,
  closeMoreMenu,
  handleMenuClick,
  openMoreMenu,
  runMenuAction,
};
