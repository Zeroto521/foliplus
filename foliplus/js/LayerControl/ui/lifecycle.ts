// LayerControl UI lifecycle — attach / detach, event binding, and the
// ready-signal re-entry. Split out of ui/index.ts (34.2). The LayerUI class
// in index.ts keeps one-line delegates; this module owns the actual wiring
// so index.ts stays a state + delegates shell.
import { EVENTS, ensureEvents } from "#core/event/index.js";
import * as CONST from "../const.js";
import {
  handleMoreClick,
  handleMoreMenuClick,
  registerInteractions,
} from "../interaction.js";
import { applyProjection, applyProjectionAll } from "./apply.js";
import { inFloatingPanel, isKeyboardVisibleFocus, owningRow } from "./context.js";
import {
  handleDragEnd,
  handleDragLeave,
  handleDragOver,
  handleDragStart,
  handleDrop,
  toggleFold,
} from "./drag.js";
import { dismissFocus } from "./focus.js";
import type { LayerUI } from "./index.js";
import {
  blurActiveItem,
  clearActiveItem,
  getNavigableItems,
  handleDblClick,
  handleKeyDown,
  syncListCursor,
} from "./keyboard.js";
import { insertLayerItem, renderInitialList } from "./list.js";
import { closeMoreMenu } from "./menu.js";
import { finishRename } from "./rename.js";
import { applyRowView, buildRowCell } from "./rowView.js";
import { snapshotAuthorVisible } from "./rowView.js";
import { applyUserState, loadPersistedState, syncHiddenId } from "./state.js";
import { closeStylePanel, invalidateFields } from "./style/index.js";
import {
  getLayerItems,
  handleChange,
  handleInput,
  syncToggleAll,
  toggleAll,
} from "./visibility.js";

/**
 * Attach UI to the given container div.
 * @param {LayerUI} ui — the LayerUI shell this wires into.
 * @param {HTMLElement} containerDiv - The panel-content div.
 */
const attachUI = (ui: LayerUI, containerDiv: HTMLElement): void => {
  ui.m.uiContainer = containerDiv;
  loadPersistedState(ui);
  renderInitialList(ui);
  bindEvents(ui);

  while (ui.m.pendingRegistrations.length) {
    const layerInfo = ui.m.pendingRegistrations.shift();
    if (layerInfo) insertLayerItem(ui, layerInfo);
  }
  // Snapshot the author's declared default before the first projection.
  // `projectLayer` reads `authorVisible.get(id) ?? true` — an absent entry
  // is read as "author declared visible" — which is exactly the class of
  // bug the quickstart hit: a folium `show=False` layer would come up on the map
  // on the first projection because the author's snapshot hasn't landed
  // yet. The snapshot is idempotent, so the later `initTypesAndVisibility`
  // re-runs don't overwrite what we took here.
  for (let i = 0; i < ui.m.layers.length; i++) {
    snapshotAuthorVisible(ui, ui.m.layers[i]);
  }
  // Last in the attach sequence: applyUserState() runs the full sweep
  // needed for rows rendered from the initial registry. Hidden ids are
  // loaded above but only applied here, so a row can never render visible
  // and get removed afterwards.
  applyUserState(ui);
  // Re-apply ARIA/roving after insertLayerItem / applyUserState may have
  // rebuilt rows.
  syncListCursor(ui);

  // Refresh counts synchronously now. Counts are cheap to compute (the
  // provider is invoked on demand; a missing Canvas just returns null),
  // and the user should not see an empty count column while we wait.
  // Heatmap in particular publishes its final count during initScan, so the
  // column may update a second time — that is driven by the event bus.
  refreshAllCounts(ui);

  // Init pass, driven by a ready signal instead of a fixed timer: run once
  // right after the synchronous attach sequence (setTimeout 0 — every
  // control finishes attaching in the same script stack, and folium layers
  // are only linked into the registry after that), then re-run whenever a
  // control attaches later (Heatmap / Measure may register layers at
  // runtime). initTypesAndVisibility is idempotent — repeated runs are
  // cheap and converge on the final layer state.
  subscribeControlAttached(ui);
  setTimeout(() => {
    if (ui.uiContainer?.isConnected) ui.initTypesAndVisibility();
  }, 0);
};

/** Re-run the init pass when another control finishes attaching. Unsubscribes
 *  in unbindEvents(). The first pass comes from the setTimeout(0) above —
 *  it lands after the synchronous attach sequence, so folium layers are
 *  already linked into the registry. Calls through the ui.initTypesAndVisibility
 *  / ui.applyStyleLabelState delegates (not the imported module functions) so
 *  `vi.spyOn(ui, ...)` in tests can still observe the re-run. */
const subscribeControlAttached = (ui: LayerUI): void => {
  ui.unsubscribeControlAttached = ui.events.on(EVENTS.CONTROL_ATTACHED, () => {
    if (!ui.uiContainer?.isConnected) return;
    ui.initTypesAndVisibility();
    // Re-apply is idempotent: a late-registered layer may just now have
    // a resolvable feature set (and thus labelable fields).
    ui.applyStyleLabelState();
  });
};

/** Load every persisted dimension in one call. */
const bindEvents = (ui: LayerUI): void => {
  const container = ui.uiContainer;
  if (!container) return;

  ui.onChange = event => {
    const checkbox = (event.target as HTMLElement).closest(
      '[data-role="toggle-all"]',
    ) as HTMLInputElement | null;
    if (checkbox) {
      const row = checkbox.closest(CONST.SEL.TOGGLE_ALL) as HTMLElement | null;
      if (!row) return;
      // Derive the target state from the actual layer selection rather than
      // checkbox.checked — the browser resets indeterminate before the change
      // event fires, making it impossible to detect the pre-click state.
      const group = row.dataset.group ?? "";
      const items = getLayerItems(ui, group);
      const noneChecked = Array.from(items).every((item: Element) => {
        const c = item.querySelector(
          'input[type="checkbox"]',
        ) as HTMLInputElement | null;
        return !c || !c.checked;
      });
      toggleAll(ui, group, noneChecked);
      return;
    }
    handleChange(ui, event);
  };
  ui.onInput = event => handleInput(ui, event);
  ui.onClick = event => {
    const el = event.target as HTMLElement;
    // A press inside a row's floating panel (attributes / style) is the
    // panel's business, not the row's. Taking the cursor over here would
    // steal DOM focus back to the row, and a native <select> popup closes
    // the instant it loses focus — so the dropdown looked like it retracted
    // the moment it opened. The panels carry their own click handling.
    if (inFloatingPanel(el)) return;
    // One ledger: pointer re-homes the index, Tab stop, and paints the
    // cursor visual. It stays until Escape, another row, or an outside
    // press takes over — same contract as the keyboard cursor.
    // (#278 only removed the accidental dblclick→focusLayer zoom.)
    const row = owningRow(el);
    if (row) {
      const idx = getNavigableItems(ui).indexOf(row);
      if (idx !== -1) {
        ui.activeIdx = idx;
        ui.listCursor?.setIndex(idx);
        blurActiveItem(ui);
        row.classList.add(CONST.CLASSES.FOCUSED);
        // Keep DOM focus on the row so Space/Enter resolve from focus, and
        // so Escape still reaches handleKeyDown's container guard — the
        // panel floats from the ⋮ press, so its own controls hold focus,
        // and this press must not park the cursor on the anchor row for
        // the whole time the user is flipping controls inside it.
        row.focus({ focusVisible: false } as FocusOptions);
      }
    }

    if (el.closest(CONST.SEL.COLOR_ITEM)) {
      ui.showColorLayer(ui.currentColor);
      syncToggleAll(ui, CONST.GROUP.BASE);
      ui.m.enforceOrder();
      return;
    }
    const toggleAllEl = el.closest(CONST.SEL.TOGGLE_ALL) as HTMLElement | null;
    if (!toggleAllEl || el.closest('[data-role="toggle-all"]')) return;
    toggleFold(ui, toggleAllEl.dataset.group ?? "");
  };

  ui.onDragStart = event => handleDragStart(ui, event);
  ui.onDragOver = event => handleDragOver(ui, event);
  ui.onDragLeave = event => handleDragLeave(ui, event);
  ui.onDrop = event => handleDrop(ui, event);
  ui.onDragEnd = () => handleDragEnd(ui);
  ui.onKeyDown = event => handleKeyDown(ui, event);
  // A real focus move is the cursor: once focus lands on a row (or a child
  // control), that row is the keyboard target.
  //
  // `:focus-visible` is sampled once, at the moment focus arrives, and
  // mapped onto the row's JS cursor class. Child controls (checkbox /
  // more / fold) attribute to the row via closest(ROW). The CSS recipe
  // never keys on `:focus-visible`, so Escape is just "remove the class".
  ui.onFocusIn = event => {
    const el = event.target as Element | null;
    if (!el || inFloatingPanel(el)) return;
    const row = owningRow(el);
    if (!row) return;
    const idx = getNavigableItems(ui).indexOf(row);
    if (idx !== -1) ui.activeIdx = idx;
    if (!isKeyboardVisibleFocus(el)) return;
    blurActiveItem(ui);
    row.classList.add(CONST.CLASSES.FOCUSED);
    ui.listCursor?.setIndex(idx);
  };
  // Focus left the row entirely (Tab away, click outside, browser chrome):
  // drop the JS cursor class. Moves within the same row keep it.
  //
  // A press inside a floating panel does NOT count as leaving: the panel is
  // nested in its own anchor row, so its controls are descendants of the
  // row the user pressed to open it, and `row.contains(relatedTarget)` is
  // true for every one of them. The user just asked the row to do a detail
  // task — they did not abandon it, so the cursor stays, and a native
  // <select> popup does not retract on losing focus.
  ui.onFocusOut = event => {
    const row = owningRow(event.target);
    if (!row || inFloatingPanel(event.target)) return;
    const next = event.relatedTarget as Element | null;
    if (next && (next === row || row.contains(next))) return;
    if (inFloatingPanel(next)) return;
    row.classList.remove(CONST.CLASSES.FOCUSED);
  };
  ui.interactionCleanup = registerInteractions(ui);

  container.addEventListener("change", ui.onChange);
  container.addEventListener("input", ui.onInput);
  container.addEventListener("click", ui.onClick);
  container.addEventListener("focusin", ui.onFocusIn);
  container.addEventListener("focusout", ui.onFocusOut);
  container.addEventListener("dragstart", ui.onDragStart);
  container.addEventListener("dragover", ui.onDragOver);
  container.addEventListener("dragleave", ui.onDragLeave);
  container.addEventListener("drop", ui.onDrop);
  container.addEventListener("dragend", ui.onDragEnd);
  // Double-click on a layer row → focus the map on that layer.
  container.addEventListener("dblclick", event =>
    handleDblClick(ui, event as MouseEvent),
  );

  // Overflow ("more") button → dropdown menu. Uses event delegation so it
  // works for rows created after bindEvents (registerLayer at runtime).
  ui.onMoreClick = event => handleMoreClick(ui, event);
  ui.onMoreMenuClick = event => handleMoreMenuClick(ui, event);
  ui.onMoreMapClick = () => closeMoreMenu(ui, false);
  container.addEventListener("click", ui.onMoreClick);
  // Menu click must be on document because the menu is positioned absolute
  // and may visually overflow the panel bounds.
  document.addEventListener("click", ui.onMoreMenuClick);
  ui.m.map.on("click", ui.onMoreMapClick);
  // A zoom change re-evaluates every layer's effective-shown: a layer whose
  // stored range excludes the new level is hidden, and one whose range
  // includes it is brought back. This is the "inRange" half of
  // effectiveShown = intent && inRange, and it writes through the single
  // pipeline so the checkbox / hiddenIds / overrides stay untouched (#329).
  ui.onZoomEnd = () => applyProjectionAll(ui);
  ui.m.map.on("zoomend", ui.onZoomEnd);
  // Keyboard dispatch for the "more" button (Enter/Space/Escape) is handled
  // by InteractionManager via registerInteractions() in interaction.ts,
  // which routes to handleKeyDown() — that method detects when the
  // MORE_BTN is focused and opens/closes the menu accordingly. Do NOT
  // add a separate container keydown listener here.

  // Subscribe to feature-count change events so a third-party provider
  // (Canvas layers) can update a single row without a full re-render.
  const bus = ensureEvents(ui.m.map);
  ui.unsubscribeCountChange = bus.on(
    EVENTS.LAYER_ITEM_COUNT_CHANGE,
    (payload: { id: string }) => onLayerItemCountChange(ui, payload.id),
  );
};

/** Called when a layer's content changes (count or type may shift at runtime).
 *  Re-computes geometry type so a layer that mixes geometry through the
 *  createLayers API (Point + LineString, etc.) shows the correct icon,
 *  not the one cached at initial attach. */
const onLayerItemCountChange = (ui: LayerUI, id: string): void => {
  if (!ui.uiContainer) return;
  const item = ui.uiContainer.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`,
  ) as HTMLElement | null;
  if (!item) return;
  const layerInfo = ui.m.layerRegistry.get(id);
  if (!layerInfo || layerInfo.isBase) return;
  invalidateFields(ui, id);

  applyRowView(ui, item, buildRowCell(ui, layerInfo));

  // Re-apply the layer's current opacity to the newly-finalized geometry.
  // The panes were painted at full opacity while the preview was live; the
  // count-change event fires at store.add, which is the moment the real
  // geometry lands — so this is when the opacity "snaps in". A canvas layer
  // may have been replaced since the previous projection wrote (its
  // `layerInfo.canvas` now points at a fresh element whose style does not
  // carry the value), so the executor's `appliedState` is invalidated for
  // this id before the re-projection: the diff sees the stored opacity as
  // new and re-applies it through the carrier dispatcher.
  if (ui.opacityMap[id] !== undefined) {
    ui.appliedState.delete(id);
    applyProjection(ui, id);
  }
};

/** Repaint every layer row from its cell — count, type, tooltip and box. */
const refreshAllCounts = (ui: LayerUI): void => {
  if (!ui.uiContainer) return;
  const items = ui.uiContainer.querySelectorAll(
    `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.COLOR_ITEM}):not(${CONST.SEL.TOGGLE_ALL})`,
  );
  items.forEach((item: Element) => {
    const id = item.getAttribute(CONST.DATA.LAYER_ID);
    const layerInfo = id ? ui.m.layerRegistry.get(id) : undefined;
    if (!layerInfo) return;
    applyRowView(ui, item as HTMLElement, buildRowCell(ui, layerInfo));
  });
};

const unbindEvents = (ui: LayerUI): void => {
  const container = ui.uiContainer;
  if (!container) return;
  closeMoreMenu(ui, false);
  closeStylePanel(ui, false);
  finishRename(ui, true);
  // Remove any focus animation still in flight (rect + row highlight).
  dismissFocus(ui);
  if (ui.onChange) container.removeEventListener("change", ui.onChange);
  if (ui.onInput) container.removeEventListener("input", ui.onInput);
  if (ui.onClick) container.removeEventListener("click", ui.onClick);
  if (ui.onFocusIn) container.removeEventListener("focusin", ui.onFocusIn);
  if (ui.onFocusOut) container.removeEventListener("focusout", ui.onFocusOut);
  if (ui.onDragStart) container.removeEventListener("dragstart", ui.onDragStart);
  if (ui.onDragOver) container.removeEventListener("dragover", ui.onDragOver);
  if (ui.onDragLeave) container.removeEventListener("dragleave", ui.onDragLeave);
  if (ui.onDrop) container.removeEventListener("drop", ui.onDrop);
  if (ui.onDragEnd) container.removeEventListener("dragend", ui.onDragEnd);
  if (ui.onMoreClick) container.removeEventListener("click", ui.onMoreClick);
  if (ui.onMoreMenuClick) {
    document.removeEventListener("click", ui.onMoreMenuClick);
  }
  if (ui.onMoreMapClick) ui.m.map.off("click", ui.onMoreMapClick);
  if (ui.onZoomEnd) ui.m.map.off("zoomend", ui.onZoomEnd);
  clearActiveItem(ui);
  ui.listCursor?.destroy();
  ui.listCursor = null;
  ui.interactionCleanup?.();
  // Flush the last pending write before the timer is cleared.
  ui.m.persistence.flushAll();
  ui.onChange = ui.onInput = ui.onClick = null;
  ui.onFocusIn = ui.onFocusOut = null;
  ui.onDragStart = ui.onDragOver = ui.onDragLeave = null;
  ui.onDrop = ui.onDragEnd = null;
  ui.onMoreClick = ui.onMoreMenuClick = null;
  ui.onMoreMapClick = null;
  ui.onZoomEnd = null;
  ui.onKeyDown = null;
  if (ui.unsubscribeCountChange) {
    ui.unsubscribeCountChange();
    ui.unsubscribeCountChange = null;
  }
  if (ui.unsubscribeControlAttached) {
    ui.unsubscribeControlAttached();
    ui.unsubscribeControlAttached = null;
  }
};

export {
  attachUI,
  bindEvents,
  onLayerItemCountChange,
  refreshAllCounts,
  subscribeControlAttached,
  unbindEvents,
};
