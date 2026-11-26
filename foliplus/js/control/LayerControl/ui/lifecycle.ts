// LayerControl UI lifecycle — attach / detach, event binding, and the
// ready-signal re-entry. Split out of ui/index.ts (34.2). The LayerUI class
// in index.ts keeps one-line delegates; this module owns the actual wiring
// so index.ts stays a state + delegates shell.
import * as CONST from "../const.js";
import { handleMoreClick, registerInteractions } from "../interaction.js";
import {
  NO_DELTA,
  applyProjection,
  applyProjectionAll,
  notifyDelta,
  notifyDeltas,
  releaseOpacityRedraws,
} from "./apply.js";
import { inFloatingPanel, isKeyboardVisibleFocus, owningRow } from "./context.js";
import { bindGeometryFocusMarquee } from "./focus/focusMarquee.js";
import { dismissFocus } from "./focus/index.js";
import { INTENT, getIntent } from "./intent.js";
import {
  blurActiveItem,
  clearActiveItem,
  getNavigableItems,
  syncListCursor,
} from "./listPanel/cursor.js";
import {
  clearDragState,
  handleDragEnd,
  handleDragLeave,
  handleDragOver,
  handleDragStart,
  handleDrop,
  toggleFold,
  toggleFolderFold,
} from "./listPanel/drag.js";
import { handleDblClick } from "./listPanel/keyboard.js";
import {
  initLayerItem,
  insertLayerItem,
  markSettled,
  renderInitialList,
  syncRowOrder,
  updateLayerItemLabel,
} from "./listPanel/list.js";
import { applyRowView, buildRowCell } from "./listPanel/rowView.js";
import {
  getLayerItems,
  handleChange,
  syncNoBasemap,
  syncToggleAll,
  toggleAll,
  toggleTarget,
} from "./listPanel/visibility.js";
import { closeAttrsPanel } from "./overlayPanel/attr.js";
import { closeFilterPanel } from "./overlayPanel/filter.js";
import { closeMoreMenu } from "./overlayPanel/menu.js";
import { finishRename } from "./overlayPanel/rename.js";
import { type PanelScope, type ScopeSubscription, createScope } from "./scope.js";
import { loadPersistedState } from "./state.js";
import {
  closeStylePanel,
  invalidateFieldCache,
  invalidateFields,
  openStylePanel,
} from "./style/index.js";
import { listDimensions } from "./style/registry.js";
import {
  dropStyleDimApplies,
  releaseStyleApplyOwner,
  scheduleStyleDimApply,
} from "./style/styleBag.js";
import { forgetDegradedHint } from "./style/valuePaint.js";
import type { LayerUI } from "./surface.js";
import { EVENTS, type EventPayloadMap, ensureEvents } from "#core/event/index.js";
import { ROLE } from "#core/layer/index.js";
import { ensureOverlayRegistry } from "#core/overlay/index.js";

/**
 * Attach UI to the given container div.
 * @param {LayerUI} ui — the LayerUI shell this wires into.
 * @param {HTMLElement} containerDiv - The panel-content div.
 */
const attachUI = (ui: LayerUI, containerDiv: HTMLElement): void => {
  ui.c.uiContainer = containerDiv;
  loadPersistedState(ui);
  renderInitialList(ui);
  bindLayerEvents(ui);
  // The registry owns Escape for every floating surface; this subscription
  // only translates its outcome into the row-cursor rule. A handled close of a
  // cursor-owning surface clears the cursor once; an unhandled Escape whose
  // target sits inside the panel (no surface open) also clears it. Surfaces
  // such as the scheme picker do not own the row cursor, so their Escape
  // leaves it alone.
  ui.unsubscribeEscape = ensureOverlayRegistry(ui.c.map).onEscapeHandled(payload => {
    if (payload.handled) {
      if (payload.clearsCursorOnClose) blurActiveItem(ui);
      return;
    }
    if (payload.target && ui.uiContainer?.contains(payload.target)) {
      blurActiveItem(ui);
    }
  });

  while (ui.c.pendingRegistrations.length) {
    const layerInfo = ui.c.pendingRegistrations.shift();
    if (layerInfo) insertLayerItem(ui, layerInfo);
  }
  // Last in the attach sequence: the single replay entry replays every
  // stored dimension for every registered layer — the A path for layers
  // seeded at construction, which never pass through registerLayer or
  // layeradd (the B path). One call site per path (replay convergence); a new dimension
  // is added to replayStoredState once and reaches both.
  const moved = ui.c.replayStoredStateAll();
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
    if (!ui.uiContainer?.isConnected) return;
    const replayed = ui.initTypesAndVisibility();
    // Same replay here as the CONTROL_ATTACHED handler below: folium's layers
    // are added after the control's own script, so that event has already
    // fired by the time their registry entries exist, and a page with only a
    // LayerControl would never have its label config applied. Idempotent.
    ui.applyStyleLabelState();
    // Second, deliberate settle+notify: this is the compensation round for
    // late-bound layers (their IDs only resolve once the page's layer globals
    // exist). The synchronous attach round above already settled and announced
    // the registry-as-seen; keep the two rounds separate, because this one can
    // carry extra flips the outer one could not have known about.
    markSettled(ui);
    notifyDeltas(ui, replayed);
  }, 0);

  markSettled(ui);
  // The round goes out last: every row is painted, the counts agree with them
  // and the readiness flag is up, so a subscriber that re-enters reads a
  // finished panel.
  notifyDeltas(ui, moved);
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
    const replayed = ui.initTypesAndVisibility();
    // Re-apply is idempotent: a late-registered layer may just now have
    // a resolvable feature set (and thus labelable fields).
    ui.applyStyleLabelState();
    markSettled(ui);
    notifyDeltas(ui, replayed);
  });
};

/** Load every persisted dimension in one call. */
const bindLayerEvents = (ui: LayerUI): void => {
  const container = ui.uiContainer;
  if (!container) return;

  ui.onChange = event => {
    const checkbox = (event.target as HTMLElement).closest(
      `[data-role="${CONST.TOGGLE_ALL_ROLE}"]`,
    ) as HTMLInputElement | null;
    if (checkbox) {
      // Climb on the row's identity key, not its class: the checkbox carries
      // the sentinel role, so the climb skips it and lands on the row that owns
      // the role.
      const row =
        (checkbox.closest(CONST.SEL.TOGGLE_ALL_ROW) as HTMLElement | null) ??
        (checkbox.closest(CONST.SEL.TOGGLE_ALL) as HTMLElement | null);
      if (!row) return;
      // Derive the target state from the actual layer selection rather than
      // checkbox.checked — the browser resets indeterminate before the change
      // event fires, making it impossible to detect the pre-click state.
      const role = row.dataset.role ?? "";
      const items = getLayerItems(ui, role);
      const on = Array.from(items).filter((item: Element) => {
        const c = item.querySelector(
          'input[type="checkbox"]',
        ) as HTMLInputElement | null;
        return c?.checked;
      }).length;
      toggleAll(ui, role, toggleTarget(on));
      return;
    }
    handleChange(ui, event);
  };
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
    // (#278 only removed the accidental dblclick → focusLayer zoom.)
    const row = owningRow(el);
    if (row) {
      const idx = getNavigableItems(ui).indexOf(row);
      if (idx !== -1) {
        ui.listPanel.activeIdx = idx;
        ui.listPanel.listCursor?.setIndex(idx);
        blurActiveItem(ui);
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

    // The fold branch climbs on the header row's identity key, never on the
    // row class (see SEL.TOGGLE_ALL_ROW), and the click landing on the row's own
    // toggle-all checkbox is the onChange path, not a fold.
    // A folder row's whole row folds its folder, reusing the
    // role handler path: the click on the row body (not the checkbox or the
    // ⋮ button, which stopPropagation in their own handlers) toggles the
    // folder. A drag does not fold (didDrag guard lives in handleDragStart).
    const folderRow = el.closest(CONST.SEL.FOLDER_ROW) as HTMLElement | null;
    if (folderRow) {
      if (
        el.closest(`.${CONST.CLASSES.CHECKBOX}`) ||
        el.closest(`.${CONST.CLASSES.MORE_BTN}`)
      ) {
        return;
      }
      const fk = folderRow.getAttribute(CONST.DATA.FOLDER_KEY);
      const role = folderRow.getAttribute(CONST.DATA.ROLE) ?? "";
      if (fk && role) {
        toggleFolderFold(ui, role, fk);
      }
      return;
    }
    const toggleAllEl =
      (el.closest(CONST.SEL.TOGGLE_ALL_ROW) as HTMLElement | null) ??
      (el.closest(CONST.SEL.TOGGLE_ALL) as HTMLElement | null);
    // The checkbox is the onChange path, and the ⋮ button owns its own click
    // handler (it opens the overflow menu). Both bubble here, so both must be
    // excluded — the folder-row branch above already excludes the same pair.
    // Without the ⋮ exclusion the menu opens and the role folds in one
    // gesture, and the rebuild tears the menu down before it can be used.
    if (
      !toggleAllEl ||
      el.closest(`[data-role="${CONST.TOGGLE_ALL_ROLE}"]`) ||
      el.closest(`.${CONST.CLASSES.MORE_BTN}`)
    ) {
      return;
    }
    toggleFold(ui, toggleAllEl.dataset.role ?? "");
  };

  ui.onDragStart = event => handleDragStart(ui, event);
  ui.onDragOver = event => handleDragOver(ui, event);
  ui.onDragLeave = event => handleDragLeave(event);
  ui.onDrop = event => handleDrop(ui, event);
  ui.onDragEnd = () => handleDragEnd(ui);
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
    if (idx !== -1) ui.listPanel.activeIdx = idx;
    if (!isKeyboardVisibleFocus(el)) return;
    blurActiveItem(ui);
    row.classList.add(CONST.CLASSES.FOCUSED);
    ui.listPanel.listCursor?.setIndex(idx);
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
  ui.listPanel.interactionCleanup = registerInteractions(ui);
  ui.geometryMarqueeCleanup = bindGeometryFocusMarquee(
    ui.c.map.getContainer(),
    ui.c.map,
  );

  container.addEventListener("change", ui.onChange);
  container.addEventListener("click", ui.onClick);
  container.addEventListener("focusin", ui.onFocusIn);
  container.addEventListener("focusout", ui.onFocusOut);
  container.addEventListener("dragstart", ui.onDragStart);
  container.addEventListener("dragover", ui.onDragOver);
  container.addEventListener("dragleave", ui.onDragLeave);
  container.addEventListener("drop", ui.onDrop);
  container.addEventListener("dragend", ui.onDragEnd);
  // Double-click on a layer row → focus the map on that layer.
  ui.onDblClick = event => handleDblClick(ui, event as MouseEvent);
  container.addEventListener("dblclick", ui.onDblClick);

  // Overflow ("more") button → dropdown menu. Uses event delegation so it
  // works for rows created after bindLayerEvents (registerLayer at runtime).
  ui.onMoreClick = event => handleMoreClick(ui, event);
  ui.onMoreMapClick = () => closeMoreMenu(ui, false);
  container.addEventListener("click", ui.onMoreClick);
  ui.c.map.on("click", ui.onMoreMapClick);
  // A zoom change re-evaluates every layer's effective-shown: a layer whose
  // stored range excludes the new level is hidden, and one whose range
  // includes it is brought back. This is the "inRange" half of
  // effectiveShown = intent && inRange, and it writes through the single
  // pipeline so the checkbox / intents.visible / overrides stay untouched (#329).
  // One settled round, not a mid-sweep spray: every layer is diffed first,
  // then each moved layer announces once, in registry order. The open style
  // panel's row sync runs in the same coordinator — projection, basemap
  // hatch, then row chrome, then the notify — so a subscriber that reads the
  // row sees the settled face rather than the pre-zoom out-of-range state.
  ui.onZoomEnd = () => {
    const swept = applyProjectionAll(ui);
    ui.overlayPanel.styleZoomEndHandler?.();
    notifyDeltas(ui, swept);
  };
  ui.c.map.on("zoomend", ui.onZoomEnd);
  // Keyboard dispatch for the "more" button (Enter/Space/Escape) is handled
  // by InteractionManager via registerInteractions() in interaction.ts,
  // which routes to handleKeyDown() — that method detects when the
  // MORE_BTN is focused and opens/closes the menu accordingly. Do NOT
  // add a separate container keydown listener here.

  // Subscribe to feature-count change events so a third-party provider
  // (Canvas layers) can update a single row without a full re-render.
  const bus = ensureEvents(ui.c.map);
  ui.unsubscribeCountChange = bus.on(
    EVENTS.LAYER_ITEM_COUNT_CHANGE,
    (payload: { id: string }) => onLayerItemCountChange(ui, payload.id),
  );

  // Layer-signal events — the manager emits these instead of calling UI
  // methods directly, so the manager no longer holds a hard dependency on
  // the view layer. Each handler does what the corresponding ui method did
  // before; the id-only payload keeps the bus a signal channel, and the
  // registry lookup here is the single source of the row's current shape.
  const registry = ui.c.layerRegistry;
  // LayerControl owns these signals; its own handlers must run before any
  // external observer, regardless of who subscribed first (phase "internal").
  const subscribe = <E extends keyof EventPayloadMap>(
    event: E,
    handler: (payload: EventPayloadMap[E]) => void,
  ): ScopeSubscription => ({
    // The event, stripped of the bus prefix and punctuation, is the step name
    // the teardown reports a failure against: "layer-item-added", not index 7.
    name: String(event)
      .replace(/^foliplus:/, "")
      .replace(/:/g, "-"),
    off: bus.on(event, handler, "internal"),
  });
  const signalHandlers: ScopeSubscription[] = [];
  signalHandlers.push(
    subscribe(EVENTS.LAYER_ITEM_ADDED, (payload: { id: string }) => {
      const layerInfo = registry.get(payload.id);
      if (layerInfo) insertLayerItem(ui, layerInfo);
    }),
    subscribe(EVENTS.LAYER_ITEM_UPDATED, (payload: { id: string }) => {
      const layerInfo = registry.get(payload.id);
      if (!layerInfo) return;
      updateLayerItemLabel(ui, layerInfo);
      invalidateFields(ui, payload.id);
    }),
    subscribe(EVENTS.LAYER_ITEM_REFRESHED, (payload: { id: string }) => {
      const layerInfo = registry.get(payload.id);
      if (layerInfo) initLayerItem(ui, layerInfo);
    }),
    // A capability is a projection of the live tree, and the style panel
    // gates its rows on it at OPEN time (opacity, fill, border, size). A
    // recovery — the foreign leaf that forced the degrade leaves — must
    // reach the panel that is already open, or the user has to close and
    // reopen it to see the row come back. Re-render that one panel; every
    // other open overlay is untouched.
    subscribe(EVENTS.LAYER_CAPABILITY_CHANGED, (payload: { id: string }) => {
      if (ui.overlayPanel.stylePanelLayerId === payload.id) {
        openStylePanel(ui, payload.id);
      }
    }),
    // A committed filter repaints the owner row: funnel + count in that
    // row's own unit. The owner publishes after its render settled, so this
    // repaint reads the final model (not the mid-drag one).
    subscribe(EVENTS.LAYER_FILTER_CHANGE, (payload: { id: string }) => {
      const layerInfo = registry.get(payload.id);
      if (!layerInfo || !ui.uiContainer) return;
      const item = ui.uiContainer.querySelector<HTMLElement>(
        `[${CONST.DATA.LAYER_ID}="${CSS.escape(payload.id)}"]`,
      );
      if (item) applyRowView(ui, item, buildRowCell(ui, layerInfo));
    }),
    subscribe(EVENTS.LAYER_ITEM_REMOVED, (payload: { id: string }) => {
      // Cache drop only: unregister already tore the labels and their canvas
      // down (label.unloadLayer runs before this event is emitted), and
      // renderLabels for a gone layer rebuilds nothing — a replay here would
      // be a walk for its own sake.
      invalidateFieldCache(ui, payload.id);
      dropStyleDimApplies(payload.id, ui);
      // The classify-degradation dedup keeps one id per hinted layer per page;
      // drop it with the layer so a page that reuses the id cannot inherit a
      // "already warned" decision from the layer that wore it first.
      forgetDegradedHint(ui.c.map, payload.id);
    }),
    subscribe(EVENTS.LAYER_ROLE_COUNT_CHANGED, (payload: { role: string }) => {
      syncToggleAll(ui, payload.role);
    }),
    subscribe(EVENTS.LAYER_LIST_REBUILD, () => {
      // The reorder signal only moves rows: the emitters (moveLayerUp/Down,
      // bringLayerToFront, the drag drop's reorderLayer) have already
      // updated the registry, repriced z and saved the order through the
      // controller's commit funnel, and a position change alters no count,
      // checkbox or readiness. So this handler relocates displaced rows
      // instead of rebuilding the panel — the full rebuildList stays on the
      // paths that change membership or row structure (fold, attach).
      syncRowOrder(ui);
    }),
    subscribe(EVENTS.LAYER_NO_BASEMAP_CHANGED, () => {
      syncNoBasemap(ui);
    }),
    // Overlay mutual exclusion — each subsystem closes itself when it hears
    // the signal. closeOverlays (teardown.ts) emits this; the subsystem that
    // is about to open sees "I'm not open" and no-ops. Focus is guarded by
    // isFocusing so the O(layers) applyProjectionAll sweep only runs when
    // there is actually a focus to tear down.
    subscribe(EVENTS.OVERLAY_CLEAR, () => closeMoreMenu(ui, true)),
    subscribe(EVENTS.OVERLAY_CLEAR, () => closeAttrsPanel(ui, false)),
    subscribe(EVENTS.OVERLAY_CLEAR, () => closeFilterPanel(ui, false)),
    subscribe(EVENTS.OVERLAY_CLEAR, () => closeStylePanel(ui, false)),
    subscribe(EVENTS.OVERLAY_CLEAR, () => finishRename(ui)),
    subscribe(EVENTS.OVERLAY_CLEAR, () => {
      if (ui.isFocusing()) dismissFocus(ui);
    }),
  );
  ui.unsubscribeLayerSignals = signalHandlers;
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
  const layerInfo = ui.c.layerRegistry.get(id);
  if (!layerInfo || layerInfo.role === ROLE.BASE) return;
  // Cheap sync cache drop — the row rebuild below re-reads the field lists,
  // so they must not survive the content that just landed. The label rebuild
  // itself is the most expensive of the replays (full tree walk + canvas
  // repaint), so it is coalesced with the other faces further down.
  invalidateFieldCache(ui, id);

  applyRowView(ui, item, buildRowCell(ui, layerInfo));

  // Re-apply the layer's current opacity to the newly-finalized geometry.
  // The panes were painted at full opacity while the preview was live; the
  // count-change event fires at store.add, which is the moment the real
  // geometry lands — so this is when the opacity "snaps in". A canvas layer
  // may have been replaced since the previous projection wrote (its
  // `layerInfo.canvas` now points at a fresh element whose style does not
  // carry the value), so the executor's runtime `applied` row is invalidated for
  // this id before the re-projection: the diff sees the stored opacity as
  // new and re-applies it through the carrier dispatcher.
  let opacityDelta = NO_DELTA;
  if (getIntent(ui, id, INTENT.OPACITY) !== undefined) {
    ui.runtimeStore.deleteApplied(id);
    opacityDelta = applyProjection(ui, id);
  }

  // Opacity replays explicitly above: its return value IS the delta the
  // notify carries below, so it cannot ride the registry loop. Every other
  // dimension declares its `contentChange` policy on the descriptor — the
  // single place a dimension states what a content change owes it, and the
  // type makes the field mandatory, so a new dimension cannot silently skip
  // the decision. The hub owns the mechanics every policy shares: sync
  // policies run inline (inside the terminal event's error contract), frame
  // policies schedule through the coalescer with the sourcing event
  // attached, and the `when` gate answers before any box is allocated.
  // Registry order is module-import order, not a semantic order: the
  // replaying faces are independent (each schedules its own coalesced
  // walk), and a future ordering dependency must be sorted explicitly, not
  // inferred from the loop.
  //
  // Every replay is queued before the notify, not after: a projection
  // consumer can throw or unregister the layer, and the scheduled replay must
  // already exist for the teardown's LAYER_ITEM_REMOVED to drop it —
  // scheduling after a throw would skip the replay entirely, and scheduling
  // after a reentrant unregister would create a task for an id that is
  // already gone. The notify stays the last step of the operation.
  for (const dim of listDimensions()) {
    const policy = dim.contentChange;
    if (policy.kind === "none") continue;
    if (policy.kind === "sync") {
      policy.run(ui, id);
      continue;
    }
    if (policy.when?.(ui, id) === false) continue;
    scheduleStyleDimApply(policy.face, id, () => policy.run(ui, id), {
      source: EVENTS.LAYER_ITEM_COUNT_CHANGE,
      owner: ui,
    });
  }
  notifyDelta(ui, layerInfo, opacityDelta);
};

/** Repaint every layer row from its cell — count, type, tooltip and box. */
const refreshAllCounts = (ui: LayerUI): void => {
  if (!ui.uiContainer) return;
  const items = ui.uiContainer.querySelectorAll(
    `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.TOGGLE_ALL})`,
  );
  items.forEach((item: Element) => {
    const id = item.getAttribute(CONST.DATA.LAYER_ID);
    const layerInfo = id ? ui.c.layerRegistry.get(id) : undefined;
    if (!layerInfo) return;
    applyRowView(ui, item as HTMLElement, buildRowCell(ui, layerInfo));
  });
};

/** The panel's teardown as one ordered, named step list.
 *
 *  Registration order IS execution order — the order test pins these names.
 *  Each subscription is its own step, so one unsubscriber that throws cannot
 *  strand the rest, and a missing `off` shows up as a gap in the list instead
 *  of a subscriber that silently outlives the panel.
 *
 *  The container-less branch is deliberate: a UI whose panel is already gone
 *  owns only what it scheduled — the drag session, the timers, the escape
 *  hook, the style-apply scheduler. It has no overlay to close, no listener to
 *  remove, no cursor to destroy and no persistence of its own to flush (that
 *  write belongs to the panel that went away), so it must NOT run the
 *  container half. */
const createTeardownScope = (ui: LayerUI): PanelScope => {
  const scope = createScope();
  // ── Owned outside the panel: always runs ──────────────────────────────
  scope.step("clear-drag-state", () => clearDragState(ui));
  // Timers this UI scheduled (the debounced opacity repaint) must not outlive
  // the panel, even when the container is already gone.
  scope.step("release-opacity-redraws", () => releaseOpacityRedraws(ui));
  scope.step("unsubscribe-escape", () => {
    ui.unsubscribeEscape?.();
    ui.unsubscribeEscape = null;
  });
  const container = ui.uiContainer;
  if (!container) {
    // No panel to close, but the UI still owns whatever it scheduled — a
    // detached UI must not leave a trailing frame (or its reporter) behind.
    scope.step("release-style-apply-owner", () => releaseStyleApplyOwner(ui));
    return scope;
  }

  // ── Open overlays ─────────────────────────────────────────────────────
  // Unmount must clean up unconditionally: a subscription may already have
  // been `off`'d by a third party, or is about to be. Emitting OVERLAY_CLEAR
  // here would only reach whatever subscribers are still listening, so the
  // close functions are called directly — OVERLAY_CLEAR stays reserved for the
  // user-driven "open A, close B" mutual exclusion.
  scope.step("close-more-menu", () => closeMoreMenu(ui, false));
  scope.step("close-style-panel", () => closeStylePanel(ui, false));
  scope.step("close-attrs-panel", () => closeAttrsPanel(ui, false));
  scope.step("close-filter-panel", () => closeFilterPanel(ui, false));
  scope.step("finish-rename", () => finishRename(ui, true));
  // Remove any focus animation still in flight (rect + row highlight).
  scope.step("dismiss-focus", () => dismissFocus(ui));

  // ── Container listeners ───────────────────────────────────────────────
  // One step per listener instead of one block: a throwing removal (a handler
  // already detached elsewhere, a patched DOM) must not leave the rest bound.
  // The handlers take FocusEvent / DragEvent / MouseEvent, so the slot is
  // typed by the callable shape only: removeEventListener receives the same
  // reference the bind added, which is all the DOM matches on.
  const listenerStep = (
    name: string,
    type: string,
    handler: ((event: never) => void) | null,
  ): void => {
    scope.step(name, () => {
      if (handler) {
        container.removeEventListener(type, handler as EventListener);
      }
    });
  };
  listenerStep("off-change", "change", ui.onChange);
  listenerStep("off-click", "click", ui.onClick);
  listenerStep("off-focusin", "focusin", ui.onFocusIn);
  listenerStep("off-focusout", "focusout", ui.onFocusOut);
  listenerStep("off-dragstart", "dragstart", ui.onDragStart);
  listenerStep("off-dragover", "dragover", ui.onDragOver);
  listenerStep("off-dragleave", "dragleave", ui.onDragLeave);
  listenerStep("off-drop", "drop", ui.onDrop);
  listenerStep("off-dragend", "dragend", ui.onDragEnd);
  listenerStep("off-dblclick", "dblclick", ui.onDblClick);
  listenerStep("off-more-click", "click", ui.onMoreClick);

  // ── Map listeners ─────────────────────────────────────────────────────
  const onMoreMapClick = ui.onMoreMapClick;
  scope.step("off-more-map-click", () => {
    if (onMoreMapClick) ui.c.map.off("click", onMoreMapClick);
  });
  const onZoomEnd = ui.onZoomEnd;
  scope.step("off-zoomend", () => {
    if (onZoomEnd) ui.c.map.off("zoomend", onZoomEnd);
  });

  // ── Panel state ───────────────────────────────────────────────────────
  scope.step("clear-active-item", () => clearActiveItem(ui));
  scope.step("destroy-list-cursor", () => {
    ui.listPanel.listCursor?.destroy();
    ui.listPanel.listCursor = null;
  });
  scope.step("interaction-cleanup", () => ui.listPanel.interactionCleanup?.());
  scope.step("geometry-marquee-cleanup", () => {
    ui.geometryMarqueeCleanup?.();
    ui.geometryMarqueeCleanup = null;
  });
  // Flush the last pending write before the timer is cleared.
  scope.step("flush-persistence", () => ui.c.persistence.flushAll());
  scope.step("reset-handlers", () => {
    ui.onChange = ui.onClick = null;
    ui.onFocusIn = ui.onFocusOut = null;
    ui.onDragStart = ui.onDragOver = ui.onDragLeave = null;
    ui.onDrop = ui.onDragEnd = null;
    ui.onMoreClick = null;
    ui.onMoreMapClick = null;
    ui.onZoomEnd = null;
  });

  // ── Bus subscriptions ─────────────────────────────────────────────────
  // `add` registers the unsubscribe as its own step and returns an idempotent
  // handle, so a dispose that runs first makes a later third-party `off` a
  // no-op instead of a double-detach.
  const unsubscribeCountChange = ui.unsubscribeCountChange;
  if (unsubscribeCountChange) {
    scope.add("unsubscribe-count-change", () => {
      unsubscribeCountChange();
      ui.unsubscribeCountChange = null;
    });
  }
  const unsubscribeControlAttached = ui.unsubscribeControlAttached;
  if (unsubscribeControlAttached) {
    scope.add("unsubscribe-control-attached", () => {
      unsubscribeControlAttached();
      ui.unsubscribeControlAttached = null;
    });
  }
  for (const subscription of ui.unsubscribeLayerSignals) {
    scope.add(`unsubscribe-${subscription.name}`, subscription.off);
  }
  // Clearing the list is a STEP, not part of building the scope: a builder
  // that mutates the owner would make the order test (and a second call) see
  // a different list depending on when it ran.
  scope.step("reset-signal-list", () => {
    ui.unsubscribeLayerSignals = [];
  });

  // Last: the close steps above flushed their trailing writes, so releasing
  // the scheduler here cancels only frames that no longer have a UI to land
  // on. Scoped to this UI — another map keeps its own boxes.
  scope.step("release-style-apply-owner", () => releaseStyleApplyOwner(ui));
  return scope;
};

/** Detach the panel: run the teardown scope, then re-raise its first failure.
 *  Every step runs before the raise, so a broken step cannot shorten the
 *  teardown — the caller still learns that something broke. */
const unbindEvents = (ui: LayerUI): void => {
  createTeardownScope(ui).dispose().throwIfFailed();
};
export {
  attachUI,
  bindLayerEvents,
  createTeardownScope,
  onLayerItemCountChange,
  refreshAllCounts,
  unbindEvents,
};
