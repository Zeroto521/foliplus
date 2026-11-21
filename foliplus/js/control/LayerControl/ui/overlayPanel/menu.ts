// LayerControl UI — Overflow (⋮) menu.
import { focusDisabledLocaleKey, focusDisabledReason } from "../focus/index.js";
import { folderFoldKey } from "../listPanel/drag.js";
import { rebuildList } from "../listPanel/list.js";
import { saveState } from "../state.js";
import { styleCapability } from "../style/index.js";
import type { LayerUI } from "../surface.js";
import { closeOverlays, subscribeLayerTearDown } from "../teardown.js";
import { filterCapabilityOf, isFilterCapable } from "./filter.js";
import { finishRename } from "./rename.js";
import { EVENTS } from "#core/event/index.js";
import { type LayerRole } from "#core/layer/index.js";
import {
  type Dismiss,
  type PanelController,
  attachPanel,
  createPanel,
} from "#core/leaflet/index.js";
import { HINT_DURATION } from "#core/overlay/index.js";
import { createInlineEditInput, dom } from "#platform/dom.js";
import * as Icons from "#platform/icon.js";
import { throttleRaf } from "#platform/throttle.js";
import { FORM_CLASS, PANEL_CLASS, placeSurface } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import * as SVGs from "#control/LayerControl/icon.js";

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
    `.${CONST.CLASSES.MORE_MENU} button`,
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

/** Re-place the open overflow menu against its owning row.
 *  The menu is position:fixed (see menu.css), so its coordinates are
 *  viewport-relative; a scroll inside the panel's scroll box (which does
 *  not bubble) is still reported by the document-level capture listener.
 *  Anchor = the owning row's ⋮ button (falls back to the row itself); the
 *  clip container is the panel's scroll box (or the map container when
 *  the row is not inside one), measured fresh each time.
 *  Gap: the shared dropdown shell zeroes its own margin-top for a JS
 *  positioned / portalled menu (common/menu.css), so the engine's gap is
 *  the single source. 4px is the minimum breathing room and keeps the menu
 *  off the clip edges on both sides. */
const MORE_MENU_GAP = 4;

const placeMoreMenu = (ui: LayerUI): void => {
  const open = ui.overlayPanel.activeMenu;
  if (!open) return;
  const { item, menu } = open;
  const btn = item.querySelector<HTMLElement>(`.${CONST.CLASSES.MORE_BTN}`);
  const anchor = (btn ?? item).getBoundingClientRect();
  const clip = item.closest<HTMLElement>(`.${PANEL_CLASS.CONTENT}`);
  const bounds = (clip ?? ui.c.map.getContainer()).getBoundingClientRect();
  const placement = placeSurface(menu, {
    anchor,
    bounds,
    size: { width: menu.offsetWidth, height: menu.scrollHeight },
    gap: MORE_MENU_GAP,
    onSide: side => menu.classList.toggle(CONST.CLASSES.MORE_MENU_UP, side === "above"),
  });
  menu.style.maxWidth = `${placement.maxWidth}px`;
  // Cap the height only when the placement actually restricts it below the
  // menu's natural height. The engine caps maxHeight to the available strip
  // (the space between the anchor and the clip edge), which is tighter than
  // the content for a small menu near the panel bottom — that would force a
  // 5-item menu into a scroll it does not need. Only a menu the strip
  // genuinely cannot hold gets the cap (and scrolls).
  menu.style.maxHeight =
    placement.maxHeight < menu.scrollHeight ? `${placement.maxHeight}px` : "";
};

/** Coalesced re-place pass bound while the menu is open. A scroll inside the
 *  panel's scroll box fires on the scroll box, not the window, but the
 *  document-level capture listener still reports it. */
const scheduleMoreMenu = (ui: LayerUI): (() => void) => {
  const run = throttleRaf(() => placeMoreMenu(ui));
  const onScroll = () => run();
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  // Row expand / collapse rebuilds the list and can move the owning row; a
  // folder toggle publishes LAYER_ROLE_COUNT_CHANGED, which re-places the
  // menu against its (possibly moved) row.
  const unsub = ui.events.on(EVENTS.LAYER_ROLE_COUNT_CHANGED, () => run());
  return () => {
    run.cancel();
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
    unsub();
  };
};

const openMoreMenu = (ui: LayerUI, item: HTMLElement) => {
  // A folder row is a .foliplus-layer-item too, but its ⋮ menu is the
  // folder entry set (rename / show / hide / delete), not the layer set.
  if (item.hasAttribute(CONST.DATA.FOLDER_KEY)) {
    openFolderMenu(ui, item);
    return;
  }
  // Tear down the competing overlays first. The rename teardown in
  // particular keeps the row's label text fresh before we read it below.
  closeOverlays(ui);

  const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
  const menu = dom.el("ul", { class: `${CONST.CLASSES.MORE_MENU} open`, role: "menu" });
  // Focus-layer is disabled for basemaps (no useful extent), hidden rows, and
  // layers whose surface reports no bounds carrier. The disabled li carries
  // cursor: not-allowed (common menu CSS) and the reason as its tooltip.
  const focusReason = focusDisabledReason(ui, item);
  const focusDisabled = focusReason !== undefined;
  const focusDisabledTitle =
    focusReason !== undefined
      ? ui.T(focusDisabledLocaleKey(focusReason))
      : ui.T("focus_layer_tooltip");

  // Capability gate: only rows that declare the filter capability render the
  // entry. A capable row with no filterable field stays visible but disabled
  // (with the empty-state reason as tooltip) so the user is told why, instead
  // of opening an empty panel.
  const filterInfo = filterCapabilityOf(ui, layerId);
  const filterHasFields = layerSupportsFilter(ui, layerId);
  // Consistent with style: a hidden layer gets no visual feedback from a
  // filter action (the panel would target an invisible layer), so the entry
  // is disabled for the same reason style is. Tooltip priority mirrors
  // style: the hidden reason first, then the no-fields reason.
  const filterDisabled = focusReason === "hidden" || !filterHasFields;
  if (filterInfo) {
    menu.appendChild(
      dom.el(
        "button",
        {
          type: "button",
          "data-action": CONST.ACTION.FILTER_LAYER,
          role: "menuitem",
          title:
            focusReason === "hidden"
              ? ui.T(focusDisabledLocaleKey("hidden"))
              : filterHasFields
                ? ui.T("filter_layer_tooltip")
                : ui.T("filter_empty"),
          "aria-disabled": filterDisabled ? "true" : "false",
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
  // One projection answers both the panel and the menu: a layer is
  // configurable when any style dimension it honestly supports is on. The
  // the reader reads the same capability slots and author declarations the rows
  // use, so the entry can never enable a panel whose rows would not render
  // (or vice versa) — and it cannot drift from the panel's dimension list.
  const cap = styleCapability(ui, layerId);
  const canConfigure = Object.values(cap.dims).some(Boolean) || cap.styleDelegation;
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
  // Deleting the folder a layer belongs to is the folder row's own operation,
  // not the layer's: each row type owns its entry set, and a layer menu with
  // two entries both labelled "Delete" would make the user guess which one
  // they are confirming (issue 11).

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
        class: `${CONST.CLASSES.MENU_DIVIDER} ${PANEL_CLASS.SECTION_DIVIDER}`,
        role: "separator",
        "aria-hidden": "true",
      }),
    );
    menu.appendChild(buildDeleteItem(ui, deleteMode));
  }

  // Tab moving focus out of the menu dismisses it — an open menu owns the
  // keyboard cursor (ARIA menu pattern). Focus wandering within the menu,
  // or onto the anchor row itself (jsdom falls a disabled-item click back
  // to the row, and a real Tab can land on the row's own controls), keeps
  // the menu open. The listener lives on the menu element, so it dies with
  // the menu on close. Click-outside and Escape close through their own
  // paths, and this re-closing is a no-op then (activeMenu is already gone).
  // Division of labour (single authority, no overlap): the PanelController
  // owns the dismissal contract (outside press, Escape, closeFromClick,
  // swallowPress, rank, exclusiveGroup, clearsCursorOnClose). The component
  // fields keep the display state (item/panel/layerId) and the detach pipe
  // (each close detaches exactly once so the next open can re-attach) — a
  // controller is rebuilt per open, so it is not a persistent handle. Slices
  // 1-2 removed the inline register object (the true double bookkeeping);
  // these fields are not a second open/closed state.
  // The PanelController owns the dismissal contract (closeFromClick for the
  // close affordance; the menu's own item clicks route through handleMenuClick,
  // which deliberately keeps its stopPropagation — an action may tear the menu
  // down mid-dispatch, and swallowing here keeps the click off the map). The
  // registry entry is generated by attachPanel below.
  const controller: PanelController = createPanel({
    owner: "layer",
    localId: "menu",
    rank: 800,
    // The menu is a map surface: opening it closes the open sibling panels of
    // its exclusive group, so a Heatmap/Measure/Search fold panel
    // cannot stay open beside the menu.
    exclusiveGroup: "map:panel",
    clearsCursorOnClose: true,
    dismiss: { outsidePress: "click" } satisfies Partial<Dismiss>,
    root: () => ui.overlayPanel.activeMenu?.menu ?? null,
    open: () => {
      item.style.position = "relative";
      item.appendChild(menu);
    },
    close: ({ restoreFocus }) => {
      closeMoreMenu(ui, restoreFocus);
      return true;
    },
  });

  menu.addEventListener("focusout", event => {
    const next = (event as FocusEvent).relatedTarget as Node | null;
    if (next && (next === item || item.contains(next))) return;
    if (!next || !menu.contains(next)) closeMoreMenu(ui, false);
  });
  // Menu item actions are dispatched locally: the old document-level click
  // delegate was the only reason the menu needed a document listener.
  menu.addEventListener("click", event => handleMenuClick(ui, event));

  ui.overlayPanel.activeMenu = { item, menu, layerId };
  // Anchor-teardown contract (cross-panel): an external delete/clear of the
  // anchored layer must not leave the menu (and its activeMenu / reposition /
  // overlay-registry state) hanging — see subscribeLayerTearDown in teardown.ts.
  // Naming NOTE: subscribeLayerTearDown listens to both LAYER_REMOVED and
  // LAYER_DELETED, so the "Removed" in this name is historical. The whole
  // *RemovedUnsub family (attrs/rename/style) shares the stale suffix; renaming
  // the family is deferred to the naming-unification pass.
  ui.overlayPanel.menuRemovedUnsub = subscribeLayerTearDown(ui, layerId, () => {
    closeMoreMenu(ui, false);
  });
  // Same PanelController wiring as attr/filter: the dismissal contract and
  // registry identity live on the controller (dismiss outsidePress is
  // "click" for the menu — a press is a click-selection, not a drag-away).
  ui.overlayPanel.menuOverlayUnregister = attachPanel(ui.c.map, controller);
  controller.open();

  // Position the menu against its owning row now that it is in the DOM, and
  // keep it re-placed on scroll / resize / row expand-collapse while open.
  placeMoreMenu(ui);
  ui.overlayPanel.menuReposition = scheduleMoreMenu(ui);

  // Focus the first menu item so Enter/Space activate it and Escape closes.
  // The head is Filter when supported, Style otherwise — both are reversible
  // actions, so the trigger-adjacent slot is always safe.
  (
    menu.querySelector<HTMLElement>(`.${CONST.CLASSES.MORE_MENU} button`) as HTMLElement
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
  /** Locale key the entry shows when idle. */
  idleKey: string;
  /** Locale key the entry shows while armed. */
  confirmKey: string;
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
const layerSupportsFilter = (ui: LayerUI, layerId: string): boolean => {
  const layer = ui.c.layerRegistry.get(layerId);
  if (!isFilterCapable(layer)) return false;
  // Generic data layers (LayerControl's own): an O(K) presence probe — never
  // a full model build, so the menu row render stays O(K) per row.
  // Heatmap/Measure/third-party owners declare their own model; their
  // presence is dimension-driven and read through the existing fallback
  // (a capable owner with a null model is an empty layer — disabled).
  return ui.c.hasFilterableFields(layerId) || layer.filterProvider() !== null;
};

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

/** The idle and confirming locale keys for a delete entry. One table for every
 *  kind of delete entry — a layer, a component's data, a folder — so the
 *  two-step confirm reads the same wherever it appears. */
const deleteLabelKeys = (menuItem: HTMLElement): { idleKey: string; confirmKey: string } => {
  if (menuItem.dataset.action === CONST.ACTION.DELETE_FOLDER) {
    return { idleKey: "delete_folder", confirmKey: "delete_folder_confirm" };
  }
  if (menuItem.dataset.mode === "clear") {
    return { idleKey: "clear_data", confirmKey: "clear_data_confirm" };
  }
  return { idleKey: "delete_layer", confirmKey: "delete_layer_confirm" };
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
  const { idleKey, confirmKey } = deleteLabelKeys(menuItem);
  // The title attribute is set by the entry builder at construction, so there
  // is no null to fall back to.
  const originalTitle = menuItem.getAttribute("title")!;
  armedDelete = { ui, label, menuItem, idleKey, confirmKey, originalTitle };
  label.textContent = ui.T(confirmKey);
  menuItem.classList.add(CONST.CLASSES.MENU_DELETE_ARMED);
  menuItem.setAttribute("title", ui.T(confirmKey));
  armedDeleteTimer = setTimeout(disarmDelete, DELETE_ARMED_TIMEOUT_MS);
};

/** Back out of the confirming state. Idempotent, and called on every path that
 *  closes the menu so an abandoned attempt never leaves an armed entry behind. */
const disarmDelete = (): void => {
  if (armedDeleteTimer) clearTimeout(armedDeleteTimer);
  armedDeleteTimer = undefined;
  const armed = armedDelete;
  if (!armed) return;
  armed.label.textContent = armed.ui.T(armed.idleKey);
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
  const action = menuItem.dataset.action;
  disarmDelete();
  if (action === CONST.ACTION.DELETE_FOLDER) {
    // The folder row owns the identity: it carries no data-layer-id, so the
    // menu record's folderKey / role / folder name are the handles. The menu
    // closes first (hard constraint 4a) — the action rerenders the list, and
    // the menu anchors to the row being rebuilt.
    const open = ui.overlayPanel.activeMenu;
    const role =
      open?.role ?? open?.item.getAttribute(CONST.DATA.ROLE) ?? "";
    const folderName = open?.item.getAttribute(CONST.DATA.FOLDER_NAME) ?? "";
    if (role && folderName) {
      ui.closeMoreMenu(true);
      ui.c.deleteFolder(role as LayerRole, folderName);
    }
    return true;
  }
  const layerId = ui.overlayPanel.activeMenu?.layerId ?? "";
  ui.c.deleteLayer(layerId);
  return true;
};

/** Close the overflow menu. setFocus = true returns focus to the layer row. */

const closeMoreMenu = (ui: LayerUI, setFocus: boolean) => {
  ui.overlayPanel.menuRemovedUnsub?.();
  ui.overlayPanel.menuRemovedUnsub = null;
  ui.overlayPanel.menuOverlayUnregister?.();
  ui.overlayPanel.menuOverlayUnregister = null;
  ui.overlayPanel.menuReposition?.();
  ui.overlayPanel.menuReposition = null;
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
const folderKeysOfRole = (ui: LayerUI, role: string): string[] => {
  const layout = ui.c.folderLayoutView;
  const keys = new Set<string>();
  for (const m of Object.values(layout.members)) {
    if (m.role === role && m.folder) keys.add(m.folder);
  }
  return [...keys];
};

const setAllFoldersFolded = (ui: LayerUI, role: string, folded: boolean) => {
  for (const key of folderKeysOfRole(ui, role)) {
    const fk = folderFoldKey(role, key);
    if (folded) ui.listPanel.foldedFolders.add(fk);
    else ui.listPanel.foldedFolders.delete(fk);
  }
  rebuildList(ui);
  saveState(ui);
};

/** Start an inline rename on a folder row's label. The folder identity is the
 *  role + normalized key; the label shows the display name. Commit calls the
 *  controller so the block key, member spellings and persistence stay single-
 *  sourced. Escape/empty cancel silently (spec §4.1: empty name = no-op). */
const startFolderRename = (
  ui: LayerUI,
  role: string,
  folderKey: string,
  folderName: string,
) => {
  const item = ui.uiContainer?.querySelector<HTMLElement>(
    `[${CONST.DATA.FOLDER_KEY}="${CSS.escape(folderKey)}"]`,
  );
  const label = item?.querySelector("label") as HTMLLabelElement | null;
  if (!label) return;
  closeOverlays(ui);
  createInlineEditInput({
    label,
    initialValue: folderName,
    className: `${CONST.CLASSES.RENAME_INPUT} ${FORM_CLASS.INPUT}`,
    ariaLabel: ui.T("rename_folder_hint"),
    isActive: () => true,
    onCommit: trimmed => {
      const next = trimmed.trim();
      if (next && next !== folderName) {
        ui.c.renameFolder(role as LayerRole, folderName, next);
      }
      finishRename(ui, true);
    },
    onCancel: () => finishRename(ui, true),
  });
};

/** Start a new folder in a role: create it (controller) then open an inline
 *  rename on its row so the user names it immediately. Blank/escape leaves the
 *  default name (spec §4.1: silent no-op on empty). */
const startNewFolder = (ui: LayerUI, role: string) => {
  const result = ui.c.createFolder(role as LayerRole, "New Folder");
  if (!result.ok) return;
  rebuildList(ui);
  // An empty folder has no members yet, so it renders no row (groupByFolder is
  // member-driven). The user names it via the folder's row once it owns a layer
  // (the move-to-folder wiring lands separately); creating here is a silent
  // no-op until then, which is the current effective behavior.
};
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
  [CONST.ACTION.DELETE_FOLDER]: (ui, menuItem) => {
    // Same two-step confirm as a layer delete: the first activation only arms,
    // so the menu stays open and the confirming label is visible.
    if (activateDeleteItem(ui, menuItem)) {
      return { closeMenu: true, restoreRowFocus: true };
    }
    return { closeMenu: false, restoreRowFocus: false };
  },
  [CONST.ACTION.RENAME_FOLDER]: ui => {
    const fk = ui.overlayPanel.activeMenu?.folderKey;
    const role =
      ui.overlayPanel.activeMenu?.role ??
      ui.overlayPanel.activeMenu?.item.getAttribute(CONST.DATA.ROLE) ??
      "";
    const name =
      ui.overlayPanel.activeMenu?.item.getAttribute(CONST.DATA.FOLDER_NAME) ?? "";
    ui.closeMoreMenu(false);
    if (fk && role && name) startFolderRename(ui, role, fk, name);
    return { closeMenu: false, restoreRowFocus: false };
  },
  [CONST.ACTION.NEW_FOLDER]: ui => {
    const role = ui.overlayPanel.activeMenu?.role ?? "";
    ui.closeMoreMenu(false);
    startNewFolder(ui, role);
    return { closeMenu: false, restoreRowFocus: false };
  },
  [CONST.ACTION.EXPAND_ALL]: ui => {
    const role = ui.overlayPanel.activeMenu?.role ?? "";
    if (role) setAllFoldersFolded(ui, role, false);
    return { closeMenu: true, restoreRowFocus: true };
  },
  [CONST.ACTION.COLLAPSE_ALL]: ui => {
    const role = ui.overlayPanel.activeMenu?.role ?? "";
    if (role) setAllFoldersFolded(ui, role, true);
    return { closeMenu: true, restoreRowFocus: true };
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

/** The shared menu-attach scaffold for the folder / role menus: create the
 *  controller, wire focus-out dismissal + click dispatch, register the panel
 *  and place + focus. `extras` extends the activeMenu record (folderKey or
 *  role). Mirrors the layer menu's attach block - one authority per menu kind. */
const attachRowMenu = (
  ui: LayerUI,
  item: HTMLElement,
  menu: HTMLElement,
  extras: { folderKey?: string; role?: string },
) => {
  const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
  const controller: PanelController = createPanel({
    owner: "layer",
    localId: "menu",
    rank: 800,
    exclusiveGroup: "map:panel",
    clearsCursorOnClose: true,
    dismiss: { outsidePress: "click" } satisfies Partial<Dismiss>,
    root: () => ui.overlayPanel.activeMenu?.menu ?? null,
    open: () => {
      item.style.position = "relative";
      item.appendChild(menu);
    },
    close: ({ restoreFocus }) => {
      closeMoreMenu(ui, restoreFocus);
      return true;
    },
  });
  menu.addEventListener("focusout", event => {
    const next = (event as FocusEvent).relatedTarget as Node | null;
    if (next && (next === item || item.contains(next))) return;
    if (!next || !menu.contains(next)) closeMoreMenu(ui, false);
  });
  menu.addEventListener("click", event => handleMenuClick(ui, event));
  ui.overlayPanel.activeMenu = { item, menu, layerId, ...extras };
  ui.overlayPanel.menuRemovedUnsub = subscribeLayerTearDown(ui, layerId, () => {
    closeMoreMenu(ui, false);
  });
  ui.overlayPanel.menuOverlayUnregister = attachPanel(ui.c.map, controller);
  controller.open();
  placeMoreMenu(ui);
  ui.overlayPanel.menuReposition = scheduleMoreMenu(ui);
  (
    menu.querySelector<HTMLElement>(`.${CONST.CLASSES.MORE_MENU} button`) as HTMLElement
  ).focus();
};

/** Open the menu for a folder row. */
const openFolderMenu = (ui: LayerUI, item: HTMLElement) => {
  closeOverlays(ui);
  const folderKey = item.getAttribute(CONST.DATA.FOLDER_KEY) ?? "";
  const menu = dom.el("ul", { class: `${CONST.CLASSES.MORE_MENU} open`, role: "menu" });
  menu.appendChild(
    dom.el(
      "button",
      {
        type: "button",
        "data-action": CONST.ACTION.RENAME_FOLDER,
        role: "menuitem",
        title: ui.T("rename_folder_tooltip"),
      },
      { html: Icons.ICON_EDIT },
      ui.T("rename_folder"),
    ),
  );
  menu.appendChild(
    dom.el("li", {
      class: `.${CONST.CLASSES.MENU_DIVIDER} .${PANEL_CLASS.SECTION_DIVIDER}`,
      role: "separator",
      "aria-hidden": "true",
    }),
  );
  menu.appendChild(
    dom.el(
      "button",
      {
        type: "button",
        "data-action": CONST.ACTION.DELETE_FOLDER,
        role: "menuitem",
        title: ui.T("delete_folder_tooltip"),
      },
      { html: Icons.ICON_DELETE },
      dom.el("span", { class: CONST.CLASSES.MENU_DELETE_LABEL }, ui.T("delete_folder")),
    ),
  );
  attachRowMenu(ui, item, menu, { folderKey });
};

/** Open the menu for a role (section) row. */
const openRoleMenu = (ui: LayerUI, item: HTMLElement) => {
  closeOverlays(ui);
  const role = item.getAttribute(CONST.DATA.ROLE) ?? "";
  const menu = dom.el("ul", { class: `${CONST.CLASSES.MORE_MENU} open`, role: "menu" });
  menu.appendChild(
    dom.el(
      "button",
      {
        type: "button",
        "data-action": CONST.ACTION.NEW_FOLDER,
        role: "menuitem",
        title: ui.T("new_folder_tooltip"),
      },
      { html: SVGs.ICON_FOLDER },
      ui.T("new_folder"),
    ),
  );
  menu.appendChild(
    dom.el(
      "button",
      {
        type: "button",
        "data-action": CONST.ACTION.EXPAND_ALL,
        role: "menuitem",
        title: ui.T("expand_all_tooltip"),
      },
      { html: SVGs.ICON_FOLD },
      ui.T("expand_all"),
    ),
  );
  menu.appendChild(
    dom.el(
      "button",
      {
        type: "button",
        "data-action": CONST.ACTION.COLLAPSE_ALL,
        role: "menuitem",
        title: ui.T("collapse_all_tooltip"),
      },
      { html: SVGs.ICON_FOLD },
      ui.T("collapse_all"),
    ),
  );
  menu.appendChild(
    dom.el("li", {
      class: `.${CONST.CLASSES.MENU_DIVIDER} .${PANEL_CLASS.SECTION_DIVIDER}`,
      role: "separator",
      "aria-hidden": "true",
    }),
  );
  attachRowMenu(ui, item, menu, { role });
};
export {
  MENU_ACTIONS,
  activateDeleteItem,
  closeMoreMenu,
  handleMenuClick,
  openMoreMenu,
  openRoleMenu,
  runMenuAction,
};
