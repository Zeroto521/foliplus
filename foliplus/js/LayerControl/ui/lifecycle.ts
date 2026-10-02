// LayerControl UI lifecycle — attach / detach, event binding, and the
// ready-signal re-entry. Split out of ui/index.ts (34.2). The LayerUI class
// in index.ts keeps one-line delegates; this module owns the actual wiring
// so index.ts stays a state + delegates shell.
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { GROUP } from "#core/layer/index.js";
import * as CONST from "../const.js";
import {
  handleMoreClick,
  handleMoreMenuClick,
  registerInteractions,
} from "../interaction.js";
import type { LayerAccess } from "./access.js";
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
import { bindGeometryFocusMarquee } from "./focusMarquee.js";
import type { FocusStore } from "./focusStore.js";
import { INTENT, getIntent } from "./intent.js";
import {
  blurActiveItem,
  clearActiveItem,
  getNavigableItems,
  handleDblClick,
  syncListCursor,
} from "./keyboard.js";
import { initTypesAndVisibility, insertLayerItem, renderInitialList } from "./list.js";
import { closeMoreMenu } from "./menu.js";
import type { PanelStore } from "./panelStore.js";
import { finishRename } from "./rename.js";
import { applyRowView, buildRowCell } from "./rowView.js";
import { snapshotAuthorVisible } from "./rowView.js";
import { applyUserState, loadPersistedState } from "./state.js";
import { applyBorderToLayer } from "./style/border.js";
import { replayFillState } from "./style/fill.js";
import {
  applyStyleLabelState,
  closeStylePanel,
  invalidateFields,
} from "./style/index.js";
import { getLayerItems, handleChange, handleInput, toggleAll } from "./visibility.js";

/**
 * Attach UI to the given container div.
 * @param {LayerAccess} la — the base-layer access face this wires into.
 * @param {HTMLElement} containerDiv - The panel-content div.
 */
const attachUI = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  containerDiv: HTMLElement,
): void => {
  la.uiContainer = containerDiv;
  ps.uiContainer = containerDiv;
  loadPersistedState(la, ps, fs);
  renderInitialList(la, ps, fs);
  bindEvents(la, ps, fs);

  while (la.pendingRegistrations.length) {
    const layerInfo = la.pendingRegistrations.shift();
    if (layerInfo) insertLayerItem(la, ps, fs, layerInfo);
  }
  // Snapshot the author's declared default before the first projection.
  // `projectLayer` reads `runtimeStore.getAuthorVisible(id) ?? true` — an absent entry
  // is read as "author declared visible" — which is exactly the class of
  // bug the quickstart hit: a folium `show=False` layer would come up on the map
  // on the first projection because the author's snapshot hasn't landed
  // yet. The snapshot is idempotent, so the later `initTypesAndVisibility`
  // re-runs don't overwrite what we took here.
  for (let i = 0; i < la.layers.length; i++) {
    snapshotAuthorVisible(la, ps, fs, la.layers[i]);
  }
  // Last in the attach sequence: applyUserState() runs the full sweep
  // needed for rows rendered from the initial registry. Hidden ids are
  // loaded above but only applied here, so a row can never render visible
  // and get removed afterwards. The UI-shell method (not the state.ts
  // function) so the border and fill dimensions are replayed too — the
  // initial layers never go through registerLayer, which is where the
  // id-specified path replays them for late registrations.
  applyUserState(la, ps, fs);
  // The state.ts sweep carries visible/opacity/zoomRange only; border and
  // fill are direct setStyle writes, so without their own replay a reload
  // would restore the drawer's swatch while the map kept the author's
  // values. Same enumeration as the coordinator's delegate (provenance).
  const layerIds = la.intentStore.userSetIds();
  for (const layerId of layerIds) {
    applyBorderToLayer(la, ps, fs, layerId);
    replayFillState(la, ps, fs, layerId);
  }
  // Re-apply ARIA/roving after insertLayerItem / applyUserState may have
  // rebuilt rows.
  syncListCursor(la, ps, fs);

  // Refresh counts synchronously now. Counts are cheap to compute (the
  // provider is invoked on demand; a missing Canvas just returns null),
  // and the user should not see an empty count column while we wait.
  // Heatmap in particular publishes its final count during initScan, so the
  // column may update a second time — that is driven by the event bus.
  refreshAllCounts(la, ps, fs);

  // Init pass, driven by a ready signal instead of a fixed timer: run once
  // right after the synchronous attach sequence (setTimeout 0 — every
  // control finishes attaching in the same script stack, and folium layers
  // are only linked into the registry after that), then re-run whenever a
  // control attaches later (Heatmap / Measure may register layers at
  // runtime). initTypesAndVisibility is idempotent — repeated runs are
  // cheap and converge on the final layer state.
  subscribeControlAttached(la, ps, fs);
  setTimeout(() => {
    if (ps.uiContainer?.isConnected) initTypesAndVisibility(la, ps, fs);
  }, 0);
};

/** Re-run the init pass when another control finishes attaching. Unsubscribes
 *  in unbindEvents(). The first pass comes from the setTimeout(0) above —
 *  it lands after the synchronous attach sequence, so folium layers are
 *  already linked into the registry. Calls through the initTypesAndVisibility
 *  / applyStyleLabelState module functions so tests can still observe the
 *  re-run. */
const subscribeControlAttached = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
): void => {
  ps.unsubscribeControlAttached = la.events.on(EVENTS.CONTROL_ATTACHED, () => {
    if (!ps.uiContainer?.isConnected) return;
    initTypesAndVisibility(la, ps, fs);
    // Re-apply is idempotent: a late-registered layer may just now have
    // a resolvable feature set (and thus labelable fields).
    applyStyleLabelState(la, ps, fs);
  });
};

/** Load every persisted dimension in one call. */
const bindEvents = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  const container = ps.uiContainer!;
  if (!container) return;

  ps.onChange = event => {
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
      const items = getLayerItems(la, ps, fs, group);
      const noneChecked = Array.from(items).every((item: Element) => {
        const c = item.querySelector(
          'input[type="checkbox"]',
        ) as HTMLInputElement | null;
        return !c || !c.checked;
      });
      toggleAll(la, ps, fs, group, noneChecked);
      return;
    }
    handleChange(la, ps, fs, event);
  };
  ps.onInput = event => handleInput(la, ps, fs, event);
  ps.onClick = event => {
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
      const idx = getNavigableItems(la, ps, fs).indexOf(row);
      if (idx !== -1) {
        ps.activeIdx = idx;
        ps.listCursor?.setIndex(idx);
        blurActiveItem(la, ps, fs);
        row.classList.add(CONST.CLASSES.FOCUSED);
        // Keep DOM focus on the row so Space/Enter resolve from focus, and
        // so Escape still reaches handleKeyDown — ownership is decided once
        // before dispatch by the interaction manager, so no container guard
        // lives here. The panel floats from the ⋮ press, so its own controls
        // hold focus, and this press must not park the cursor on the anchor
        // row for the whole time the user is flipping controls inside it.
        row.focus({ focusVisible: false } as FocusOptions);
      }
    }

    const toggleAllEl = el.closest(CONST.SEL.TOGGLE_ALL) as HTMLElement | null;
    if (!toggleAllEl || el.closest('[data-role="toggle-all"]')) return;
    toggleFold(la, ps, fs, toggleAllEl.dataset.group ?? "");
  };

  ps.onDragStart = event => handleDragStart(la, ps, fs, event);
  ps.onDragOver = event => handleDragOver(la, ps, fs, event);
  ps.onDragLeave = event => handleDragLeave(la, ps, fs, event);
  ps.onDrop = event => handleDrop(la, ps, fs, event);
  ps.onDragEnd = () => handleDragEnd(la, ps, fs);
  // A real focus move is the cursor: once focus lands on a row (or a child
  // control), that row is the keyboard target.
  //
  // `:focus-visible` is sampled once, at the moment focus arrives, and
  // mapped onto the row's JS cursor class. Child controls (checkbox /
  // more / fold) attribute to the row via closest(ROW). The CSS recipe
  // never keys on `:focus-visible`, so Escape is just "remove the class".
  ps.onFocusIn = event => {
    const el = event.target as Element | null;
    if (!el || inFloatingPanel(el)) return;
    const row = owningRow(el);
    if (!row) return;
    const idx = getNavigableItems(la, ps, fs).indexOf(row);
    if (idx !== -1) ps.activeIdx = idx;
    if (!isKeyboardVisibleFocus(el)) return;
    blurActiveItem(la, ps, fs);
    row.classList.add(CONST.CLASSES.FOCUSED);
    ps.listCursor?.setIndex(idx);
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
  ps.onFocusOut = event => {
    const row = owningRow(event.target);
    if (!row || inFloatingPanel(event.target)) return;
    const next = event.relatedTarget as Element | null;
    if (next && (next === row || row.contains(next))) return;
    if (inFloatingPanel(next)) return;
    row.classList.remove(CONST.CLASSES.FOCUSED);
  };
  ps.interactionCleanup = registerInteractions(la, ps, fs);
  ps.geometryMarqueeCleanup = bindGeometryFocusMarquee(la.map.getContainer());

  container.addEventListener("change", ps.onChange);
  container.addEventListener("input", ps.onInput);
  container.addEventListener("click", ps.onClick);
  container.addEventListener("focusin", ps.onFocusIn);
  container.addEventListener("focusout", ps.onFocusOut);
  container.addEventListener("dragstart", ps.onDragStart);
  container.addEventListener("dragover", ps.onDragOver);
  container.addEventListener("dragleave", ps.onDragLeave);
  container.addEventListener("drop", ps.onDrop);
  container.addEventListener("dragend", ps.onDragEnd);
  // Double-click on a layer row → focus the map on that layer.
  container.addEventListener("dblclick", event =>
    handleDblClick(la, ps, fs, event as MouseEvent),
  );

  // Overflow ("more") button → dropdown menu. Uses event delegation so it
  // works for rows created after bindEvents (registerLayer at runtime).
  ps.onMoreClick = event => handleMoreClick(la, ps, fs, event);
  ps.onMoreMenuClick = event => handleMoreMenuClick(la, ps, fs, event);
  ps.onMoreMapClick = () => closeMoreMenu(la, ps, fs, false);
  container.addEventListener("click", ps.onMoreClick);
  // Menu click must be on document because the menu is positioned absolute
  // and may visually overflow the panel bounds.
  document.addEventListener("click", ps.onMoreMenuClick);
  la.map.on("click", ps.onMoreMapClick);
  // A zoom change re-evaluates every layer's effective-shown: a layer whose
  // stored range excludes the new level is hidden, and one whose range
  // includes it is brought back. This is the "inRange" half of
  // effectiveShown = intent && inRange, and it writes through the single
  // pipeline so the checkbox / intents.visible / overrides stay untouched (#329).
  ps.onZoomEnd = () => applyProjectionAll(la, ps, fs);
  la.map.on("zoomend", ps.onZoomEnd);
  // Keyboard dispatch for the "more" button (Enter/Space/Escape) is handled
  // by InteractionManager via registerInteractions() in interaction.ts,
  // which routes to handleKeyDown() — that method detects when the
  // MORE_BTN is focused and opens/closes the menu accordingly. Do NOT
  // add a separate container keydown listener here.

  // Subscribe to feature-count change events so a third-party provider
  // (Canvas layers) can update a single row without a full re-render.
  const bus = ensureEvents(la.map);
  ps.unsubscribeCountChange = bus.on(
    EVENTS.LAYER_ITEM_COUNT_CHANGE,
    (payload: { id: string }) => onLayerItemCountChange(la, ps, fs, payload.id),
  );
};

/** Called when a layer's content changes (count or type may shift at runtime).
 *  Re-computes geometry type so a layer that mixes geometry through the
 *  createLayers API (Point + LineString, etc.) shows the correct icon,
 *  not the one cached at initial attach. */
const onLayerItemCountChange = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  id: string,
): void => {
  if (!ps.uiContainer) return;
  const item = ps.uiContainer!.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`,
  ) as HTMLElement | null;
  if (!item) return;
  const layerInfo = la.layerRegistry.get(id);
  if (!layerInfo || layerInfo.group === GROUP.BASE) return;
  invalidateFields(la, ps, fs, id);

  applyRowView(la, ps, fs, item, buildRowCell(la, ps, fs, layerInfo));

  // Re-apply the layer's current opacity to the newly-finalized geometry.
  // The panes were painted at full opacity while the preview was live; the
  // count-change event fires at store.add, which is the moment the real
  // geometry lands — so this is when the opacity "snaps in". A canvas layer
  // may have been replaced since the previous projection wrote (its
  // `layerInfo.canvas` now points at a fresh element whose style does not
  // carry the value), so the executor's runtime `applied` row is invalidated for
  // this id before the re-projection: the diff sees the stored opacity as
  // new and re-applies it through the carrier dispatcher.
  if (getIntent(la, id, INTENT.OPACITY) !== undefined) {
    la.runtimeStore.deleteApplied(id);
    applyProjection(la, ps, fs, id);
  }
};

/** Repaint every layer row from its cell — count, type, tooltip and box. */
const refreshAllCounts = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  if (!ps.uiContainer) return;
  const items = ps.uiContainer!.querySelectorAll(
    `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.TOGGLE_ALL})`,
  );
  items.forEach((item: Element) => {
    const id = item.getAttribute(CONST.DATA.LAYER_ID);
    const layerInfo = id ? la.layerRegistry.get(id) : undefined;
    if (!layerInfo) return;
    applyRowView(la, ps, fs, item as HTMLElement, buildRowCell(la, ps, fs, layerInfo));
  });
};

const unbindEvents = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  const container = ps.uiContainer!;
  if (!container) return;
  closeMoreMenu(la, ps, fs, false);
  closeStylePanel(la, ps, fs, false);
  finishRename(la, ps, fs, true);
  // Remove any focus animation still in flight (rect + row highlight).
  dismissFocus(la, ps, fs);
  if (ps.onChange) container.removeEventListener("change", ps.onChange);
  if (ps.onInput) container.removeEventListener("input", ps.onInput);
  if (ps.onClick) container.removeEventListener("click", ps.onClick);
  if (ps.onFocusIn) container.removeEventListener("focusin", ps.onFocusIn);
  if (ps.onFocusOut) container.removeEventListener("focusout", ps.onFocusOut);
  if (ps.onDragStart) container.removeEventListener("dragstart", ps.onDragStart);
  if (ps.onDragOver) container.removeEventListener("dragover", ps.onDragOver);
  if (ps.onDragLeave) container.removeEventListener("dragleave", ps.onDragLeave);
  if (ps.onDrop) container.removeEventListener("drop", ps.onDrop);
  if (ps.onDragEnd) container.removeEventListener("dragend", ps.onDragEnd);
  if (ps.onMoreClick) container.removeEventListener("click", ps.onMoreClick);
  if (ps.onMoreMenuClick) {
    document.removeEventListener("click", ps.onMoreMenuClick);
  }
  if (ps.onMoreMapClick) la.map.off("click", ps.onMoreMapClick);
  if (ps.onZoomEnd) la.map.off("zoomend", ps.onZoomEnd);
  clearActiveItem(la, ps, fs);
  ps.listCursor?.destroy();
  ps.listCursor = null;
  ps.interactionCleanup?.();
  ps.geometryMarqueeCleanup?.();
  ps.geometryMarqueeCleanup = null;
  // Flush the last pending write before the timer is cleared.
  la.persistence.flushAll();
  ps.onChange = ps.onInput = ps.onClick = null;
  ps.onFocusIn = ps.onFocusOut = null;
  ps.onDragStart = ps.onDragOver = ps.onDragLeave = null;
  ps.onDrop = ps.onDragEnd = null;
  ps.onMoreClick = ps.onMoreMenuClick = null;
  ps.onMoreMapClick = null;
  ps.onZoomEnd = null;
  if (ps.unsubscribeCountChange) {
    ps.unsubscribeCountChange();
    ps.unsubscribeCountChange = null;
  }
  if (ps.unsubscribeControlAttached) {
    ps.unsubscribeControlAttached();
    ps.unsubscribeControlAttached = null;
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
