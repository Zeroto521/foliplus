// LayerControl UI — class shell: state, lifecycle, event wiring, delegates.
// Heavy lifting lives in `ui/*` modules; this class owns state and wiring.
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { GEOM_TYPE, type LayerInfo, getGeometryType } from "#core/layer/index.js";
import { ListCursor } from "#core/listCursor.js";
import { formatNumber } from "#common/format.js";
import * as CONST from "./const.js";
import * as SVGs from "./icon.js";
import {
  handleMoreClick,
  handleMoreMenuClick,
  registerInteractions,
} from "./interaction.js";
import type { LayerManager } from "./manager.js";
import { closeAttrsPanel, openAttrsPanel } from "./ui/attrs.js";
import { hideColorLayer, showColorLayer } from "./ui/color.js";
import {
  handleDragEnd,
  handleDragLeave,
  handleDragOver,
  handleDragStart,
  handleDrop,
  showReorderBlockedHint,
  toggleFold,
} from "./ui/drag.js";
import {
  bringFocusedLayerToFront,
  cancelFocus,
  clearAutoCancel,
  clearFocusedRowHighlight,
  computeLayerBounds,
  dismissFocus,
  drawFocusMask,
  drawFocusRect,
  focusLayer,
  hideOtherLayers,
  highlightFocusedRow,
  isFocusLayerDisabled,
  isFocusing,
  registerAutoCancel,
  restoreHiddenLayers,
  showBaseFocusHint,
  toggleFocusedLayer,
} from "./ui/focus.js";
import {
  blurActiveItem,
  clearActiveItem,
  cursorRef,
  escapeClearCursor,
  findVisibleNeighbor,
  focusLayerRow,
  getActiveLayerItem,
  getNavigableItems,
  handleDblClick,
  handleKeyDown,
  handleOutsideMousedown,
  moveActiveMarker,
  resolveActiveIdx,
  restoreCursor,
  setActiveItem,
  syncActiveItem,
  syncListCursor,
} from "./ui/keyboard.js";
import {
  colorLayerName,
  displayName,
  initLayerItem,
  initTypesAndVisibility,
  insertLayerItem,
  reindexAfterMove,
  reindexItems,
  renderColorLayerItem,
  renderInitialList,
  renderLayerItem,
  renderToggleAllRow,
  updateLayerItem,
} from "./ui/list.js";
import { closeMoreMenu, openMoreMenu } from "./ui/menu.js";
import { finishRename, renameLayer } from "./ui/rename.js";
import { T, isKeyboardVisibleFocus, owningRow } from "./ui/shared.js";
import {
  applyHiddenOne,
  applyHiddenStateOne,
  applyUserState,
  applyVisibleStateOne,
  loadPersistedState,
  reconcileHiddenIds,
  saveFoldState,
  saveHiddenIds,
  saveNamesState,
  syncHiddenId,
} from "./ui/state.js";
import {
  getLayerItems,
  handleChange,
  handleInput,
  syncToggleAll,
  syncVisibility,
  toggleAll,
} from "./ui/visibility.js";
import * as Util from "./util.js";

/** UI Controller for LayerControl. */
class LayerUI {
  manager: LayerManager;
  foldedGroups: Set<string>;
  /** Layer ids hidden by the user (checked-off); survives page reload. */
  hiddenIds: Set<string>;
  /** The visibility key existed in storage, so `hiddenIds` is the user's
   *  assertion about every layer. Absent means no choice was ever made and the
   *  author's `show=` defaults must not be overridden by an unhide sweep. */
  hiddenHasState: boolean;
  /** Set once the hidden set has been rebuilt against the rendered rows --
   *  reconcileHiddenIds must run a single time, after the first
   *  initLayerItem pass, not on every fold-toggle. */
  isHiddenReconciled: boolean;
  isColorActive: boolean;
  currentColor: string;
  /** Map of layer id → user-assigned display name (survives reload). */
  renamedNames: Record<string, string>;
  /** Layer id whose label is currently an inline rename input, or null. */
  activeRenameId: string | null;
  dragIdx: number | null;
  lastDragHintAt: number;
  lastDragOverItem: HTMLElement | null;
  activeIdx: number | null;
  /** Shared list cursor — ARIA roles + roving tabindex on navigable rows. */
  listCursor: ListCursor | null;
  private interactionCleanup?: () => void;
  declare onChange: ((event: Event) => void) | null;
  declare onInput: ((event: Event) => void) | null;
  declare onClick: ((event: Event) => void) | null;
  declare onFocusIn: ((event: FocusEvent) => void) | null;
  declare onFocusOut: ((event: FocusEvent) => void) | null;
  declare onDragStart: ((event: DragEvent) => void) | null;
  declare onDragOver: ((event: DragEvent) => void) | null;
  declare onDragLeave: ((event: DragEvent) => void) | null;
  declare onDragEnd: ((event: DragEvent) => void) | null;
  declare onDrop: ((event: DragEvent) => void) | null;
  declare onKeyDown: ((event: KeyboardEvent) => void) | null;
  /** Click handler for the "more" (⋮) button. */
  onMoreClick: ((event: Event) => void) | null;
  /** Click handler for the dropdown menu items. */
  onMoreMenuClick: ((event: Event) => void) | null;
  /** Listen-map handler to detect clicks outside the open menu. */
  onMoreMapClick: ((event: L.LeafletEvent) => void) | null;
  /** Unsubscribe function for LAYER_ITEM_COUNT_CHANGE. */
  unsubscribeCountChange: (() => void) | null;
  /** Unsubscribe for the control-attached ready signal. */
  private unsubscribeControlAttached: (() => void) | null;
  /** Currently visible overflow menu (or null). */
  declare activeMenu: {
    item: HTMLElement;
    menu: HTMLElement;
    layerId: string;
  } | null;
  /** Currently visible attributes panel (or null). */
  declare activeAttrsPanel: {
    item: HTMLElement;
    panel: HTMLElement;
    layerId: string;
  } | null;
  /** Document capture-phase mousedown used to dismiss the attrs panel.
   *  Capture is required: the layer control's disableClickPropagation
   *  stops bubble-phase events from ever reaching document. */
  attrsOutsideHandler: ((event: MouseEvent) => void) | null;
  /** Temporary Rectangle overlay drawn while a focus is in progress. */
  focusRect: L.Layer | null;
  /** Layer id currently being focused, or null. */
  focusingLayerId: string | null;
  /** One-shot map move/zoom handler that auto-cancels focus when the user navigates. */
  onFocusMapMove: (() => void) | null;
  /** Inverse-mask polygon that dims everything outside the focused bounds. */
  focusMask: L.Polygon | null;
  /** SVG renderer hosting the focus overlay (mask + rectangle). */
  focusRenderer: L.SVG | null;
  /** Restore callbacks for pane z-indexes lifted to bring the focused layer
   *  to the front (cleared on cancel). */
  focusedPaneRestores: Array<() => void>;

  constructor(manager: LayerManager) {
    this.manager = manager;
    this.foldedGroups = new Set();
    this.hiddenIds = new Set();
    this.hiddenHasState = false;
    this.isHiddenReconciled = false;
    this.isColorActive = false;
    this.currentColor = CONST.COLOR.DEFAULT;
    this.renamedNames = {};
    this.activeRenameId = null;
    this.dragIdx = null;
    this.lastDragHintAt = 0;
    this.lastDragOverItem = null;
    this.activeIdx = null;
    this.listCursor = null;
    this.unsubscribeCountChange = null;
    this.unsubscribeControlAttached = null;
    this.onMoreClick = null;
    this.onMoreMenuClick = null;
    this.onMoreMapClick = null;
    this.activeMenu = null;
    this.attrsOutsideHandler = null;
    this.focusRect = null;
    this.focusingLayerId = null;
    this.onFocusMapMove = null;
    this.focusMask = null;
    this.focusRenderer = null;
    this.focusedPaneRestores = [];
  }

  /** Alias for convenience */

  /** Alias for convenience */
  get m() {
    return this.manager;
  }

  /** The attached panel container. Only valid after attachUI(). */

  /** The attached panel container. Only valid after attachUI(). */
  get uiContainer(): HTMLElement {
    return this.m.uiContainer!;
  }

  /** LayerAPI typed to expose getFeatureCount (LayerManager only). */

  /** LayerAPI typed to expose getFeatureCount (LayerManager only). */
  get mgmt(): LayerManager & { getFeatureCount: (i: string) => number | null } {
    return this.m as LayerManager & { getFeatureCount: (i: string) => number | null };
  }

  /**
   * Attach UI to the given container div.
   * @param {HTMLElement} containerDiv - The panel-content div.
   */

  /**
   * Attach UI to the given container div.
   * @param {HTMLElement} containerDiv - The panel-content div.
   */
  attachUI(containerDiv: HTMLElement) {
    this.m.uiContainer = containerDiv;
    this.loadPersistedState();
    this.renderInitialList();
    this.bindEvents();

    while (this.m.pendingRegistrations.length) {
      const layerInfo = this.m.pendingRegistrations.shift();
      if (layerInfo) this.insertLayerItem(layerInfo, { reindex: false });
    }
    this.reindexItems();
    // Last in the attach sequence: applyUserState() runs the full sweep
    // needed for rows rendered from the initial registry. Hidden ids are
    // loaded above but only applied here, so a row can never render visible
    // and get removed afterwards.
    this.applyUserState();
    // Re-apply ARIA/roving after insertLayerItem / applyUserState may have
    // rebuilt rows.
    this.syncListCursor();

    // Refresh counts synchronously now. Counts are cheap to compute (the
    // provider is invoked on demand; a missing Canvas just returns null),
    // and the user should not see an empty count column while we wait.
    // Heatmap in particular publishes its final count during initScan, so the
    // column may update a second time — that is driven by the event bus.
    this.refreshAllCounts();

    // Init pass, driven by a ready signal instead of a fixed timer: run once
    // right after the synchronous attach sequence (setTimeout 0 — every
    // control finishes attaching in the same script stack, and folium layers
    // are only linked into the registry after that), then re-run whenever a
    // control attaches later (Heatmap / Measure may register layers at
    // runtime). initTypesAndVisibility is idempotent — repeated runs are
    // cheap and converge on the final layer state.
    this.subscribeControlAttached();
    setTimeout(() => {
      if (this.uiContainer?.isConnected) this.initTypesAndVisibility();
    }, 0);
  }

  /** Re-run the init pass when another control finishes attaching. Unsubscribes
   *  in unbindEvents(). The first pass comes from the setTimeout(0) above —
   *  it lands after the synchronous attach sequence, so folium layers are
   *  already linked into the registry. */

  /** Re-run the init pass when another control finishes attaching. Unsubscribes
   *  in unbindEvents(). The first pass comes from the setTimeout(0) above —
   *  it lands after the synchronous attach sequence, so folium layers are
   *  already linked into the registry. */
  private subscribeControlAttached(): void {
    this.unsubscribeControlAttached = ensureEvents(this.m.map).on(
      EVENTS.CONTROL_ATTACHED,
      () => {
        if (!this.uiContainer?.isConnected) return;
        this.initTypesAndVisibility();
      },
    );
  }

  /** Load every persisted dimension in one call. */

  bindEvents() {
    const container = this.uiContainer;
    if (!container) return;

    this.onChange = event => {
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
        const items = this.getLayerItems(group);
        const noneChecked = Array.from(items).every((item: Element) => {
          const c = item.querySelector(
            'input[type="checkbox"]',
          ) as HTMLInputElement | null;
          return !c || !c.checked;
        });
        this.toggleAll(group, noneChecked);
        return;
      }
      this.handleChange(event);
    };
    this.onInput = event => this.handleInput(event);
    this.onClick = event => {
      const el = event.target as HTMLElement;
      // One ledger: pointer re-homes the index, Tab stop, and paints the
      // cursor visual. It stays until Escape, another row, or an outside
      // press takes over — same contract as the keyboard cursor.
      // (#278 only removed the accidental dblclick→focusLayer zoom.)
      const row = owningRow(el);
      if (row) {
        const idx = this.getNavigableItems().indexOf(row);
        if (idx !== -1) {
          this.activeIdx = idx;
          this.listCursor?.setIndex(idx);
          this.blurActiveItem();
          row.classList.add(CONST.CLASSES.FOCUSED);
          // Keep DOM focus on the row so Space/Enter resolve from focus.
          row.focus({ focusVisible: false } as FocusOptions);
        }
      }

      if (el.closest(CONST.SEL.COLOR_ITEM)) {
        this.deselectAllBaseMaps(-1);
        this.showColorLayer(this.currentColor);
        this.syncToggleAll(CONST.GROUP.BASE);
        this.m.enforceOrder();
        return;
      }
      const toggleAll = el.closest(CONST.SEL.TOGGLE_ALL) as HTMLElement | null;
      if (!toggleAll || el.closest('[data-role="toggle-all"]')) return;
      this.toggleFold(toggleAll.dataset.group ?? "");
    };

    this.onDragStart = event => this.handleDragStart(event);
    this.onDragOver = event => this.handleDragOver(event);
    this.onDragLeave = event => this.handleDragLeave(event);
    this.onDrop = event => this.handleDrop(event);
    this.onDragEnd = () => this.handleDragEnd();
    this.onKeyDown = event => this.handleKeyDown(event);
    // A real focus move is the cursor: once focus lands on a row (or a child
    // control), that row is the keyboard target.
    //
    // `:focus-visible` is sampled once, at the moment focus arrives, and
    // mapped onto the row's JS cursor class. Child controls (checkbox /
    // more / fold) attribute to the row via closest(ROW). The CSS recipe
    // never keys on `:focus-visible`, so Escape is just "remove the class".
    this.onFocusIn = event => {
      const el = event.target as Element | null;
      const row = owningRow(el);
      if (!el || !row) return;
      const idx = this.getNavigableItems().indexOf(row);
      if (idx !== -1) this.activeIdx = idx;
      if (!isKeyboardVisibleFocus(el)) return;
      this.blurActiveItem();
      row.classList.add(CONST.CLASSES.FOCUSED);
      this.listCursor?.setIndex(idx);
    };
    // Focus left the row entirely (Tab away, click outside, browser chrome):
    // drop the JS cursor class. Moves within the same row keep it.
    this.onFocusOut = event => {
      const row = owningRow(event.target);
      if (!row) return;
      const next = event.relatedTarget as Element | null;
      if (next && (next === row || row.contains(next))) return;
      row.classList.remove(CONST.CLASSES.FOCUSED);
    };
    this.interactionCleanup = registerInteractions(this);

    container.addEventListener("change", this.onChange);
    container.addEventListener("input", this.onInput);
    container.addEventListener("click", this.onClick);
    container.addEventListener("focusin", this.onFocusIn);
    container.addEventListener("focusout", this.onFocusOut);
    container.addEventListener("dragstart", this.onDragStart);
    container.addEventListener("dragover", this.onDragOver);
    container.addEventListener("dragleave", this.onDragLeave);
    container.addEventListener("drop", this.onDrop);
    container.addEventListener("dragend", this.onDragEnd);
    // Double-click on a layer row → focus the map on that layer.
    container.addEventListener("dblclick", event =>
      this.handleDblClick(event as MouseEvent),
    );

    // Overflow ("more") button → dropdown menu. Uses event delegation so it
    // works for rows created after bindEvents (registerLayer at runtime).
    this.onMoreClick = event => handleMoreClick(this, event);
    this.onMoreMenuClick = event => handleMoreMenuClick(this, event);
    this.onMoreMapClick = () => this.closeMoreMenu(false);
    container.addEventListener("click", this.onMoreClick);
    // Menu click must be on document because the menu is positioned absolute
    // and may visually overflow the panel bounds.
    document.addEventListener("click", this.onMoreMenuClick);
    this.m.map.on("click", this.onMoreMapClick);
    // Keyboard dispatch for the "more" button (Enter/Space/Escape) is handled
    // by InteractionManager via registerInteractions() in interaction.ts,
    // which routes to handleKeyDown() — that method detects when the
    // MORE_BTN is focused and opens/closes the menu accordingly. Do NOT
    // add a separate container keydown listener here.

    // Subscribe to feature-count change events so a third-party provider
    // (Canvas layers) can update a single row without a full re-render.
    const bus = ensureEvents(this.m.map);
    this.unsubscribeCountChange = bus.on(
      EVENTS.LAYER_ITEM_COUNT_CHANGE,
      (payload: { id: string }) => this.onLayerItemCountChange(payload.id),
    );
  }

  /** Called when a layer's content changes (count or type may shift at runtime).
   *  Re-computes geometry type so a layer that mixes geometry through the
   *  createLayers API (Point + LineString, etc.) shows the correct icon,
   *  not the one cached at initial attach. */

  /** Called when a layer's content changes (count or type may shift at runtime).
   *  Re-computes geometry type so a layer that mixes geometry through the
   *  createLayers API (Point + LineString, etc.) shows the correct icon,
   *  not the one cached at initial attach. */
  onLayerItemCountChange(id: string) {
    if (!this.uiContainer) return;
    const item = this.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`,
    ) as HTMLElement | null;
    if (!item) return;
    const layerInfo = this.m.layerRegistry.get(id);
    if (!layerInfo || layerInfo.isBase) return;
    const count = this.mgmt.getFeatureCount(id);
    const countCol = item.querySelector(CONST.SEL.COUNT_COL) as HTMLElement | null;
    const typeCol = item.querySelector(
      `.${CONST.CLASSES.TYPE_ICON_COL}`,
    ) as HTMLElement | null;

    // Re-detect geometry type (iconSvg-only layers keep their custom SVG).
    let typeLabel = item.getAttribute(CONST.DATA.TITLE) ?? "";
    if (typeCol && !layerInfo.iconSvg) {
      const layer = this.m.findLayer(layerInfo);
      const gtype = layer ? getGeometryType(layer) : GEOM_TYPE.UNKNOWN;
      layerInfo.type = gtype;
      typeCol.innerHTML = layer ? Util.getTypeSVG(layer, gtype) : SVGs.UNKNOWN;
      typeLabel = T(`type_${gtype}`);
    }

    if (countCol && count !== null && count !== undefined) {
      countCol.textContent = formatNumber(count, "auto", CONF.locale_code);
    } else if (countCol) {
      countCol.textContent = "";
    }
    item.setAttribute(CONST.DATA.TITLE, typeLabel);
    item.title =
      count !== null
        ? `${formatNumber(count, "auto", CONF.locale_code)} ${typeLabel}`
        : typeLabel;
  }

  /** Refresh count column for every overlay item (no title change). */

  /** Refresh count column for every overlay item (no title change). */
  refreshAllCounts() {
    if (!this.uiContainer) return;
    const items = this.uiContainer.querySelectorAll(
      `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.COLOR_ITEM}):not(${CONST.SEL.TOGGLE_ALL})`,
    );
    items.forEach((item: Element) => {
      const id = item.getAttribute(CONST.DATA.LAYER_ID);
      if (!id) return;
      const count = this.mgmt.getFeatureCount(id);
      const countCol = item.querySelector(CONST.SEL.COUNT_COL) as HTMLElement | null;
      if (countCol && count !== null && count !== undefined) {
        countCol.textContent = formatNumber(count, "auto", CONF.locale_code);
      } else if (countCol) countCol.textContent = "";
    });
  }

  unbindEvents() {
    const container = this.uiContainer;
    if (!container) return;
    this.closeMoreMenu(false);
    this.finishRename(true);
    // Remove any focus animation still in flight (rect + row highlight).
    this.dismissFocus();
    if (this.onChange) container.removeEventListener("change", this.onChange);
    if (this.onInput) container.removeEventListener("input", this.onInput);
    if (this.onClick) container.removeEventListener("click", this.onClick);
    if (this.onFocusIn) container.removeEventListener("focusin", this.onFocusIn);
    if (this.onFocusOut) container.removeEventListener("focusout", this.onFocusOut);
    if (this.onDragStart) container.removeEventListener("dragstart", this.onDragStart);
    if (this.onDragOver) container.removeEventListener("dragover", this.onDragOver);
    if (this.onDragLeave) container.removeEventListener("dragleave", this.onDragLeave);
    if (this.onDrop) container.removeEventListener("drop", this.onDrop);
    if (this.onDragEnd) container.removeEventListener("dragend", this.onDragEnd);
    if (this.onMoreClick) container.removeEventListener("click", this.onMoreClick);
    if (this.onMoreMenuClick) {
      document.removeEventListener("click", this.onMoreMenuClick);
    }
    if (this.onMoreMapClick) this.m.map.off("click", this.onMoreMapClick);
    this.clearActiveItem();
    this.listCursor?.destroy();
    this.listCursor = null;
    this.interactionCleanup?.();
    // Flush the last pending write before the timer is cleared.
    this.m.persistence.flushAll();
    this.onChange = this.onInput = this.onClick = null;
    this.onFocusIn = this.onFocusOut = null;
    this.onDragStart = this.onDragOver = this.onDragLeave = null;
    this.onDrop = this.onDragEnd = null;
    this.onMoreClick = this.onMoreMenuClick = null;
    this.onMoreMapClick = null;
    this.onKeyDown = null;
    if (this.unsubscribeCountChange) {
      this.unsubscribeCountChange();
      this.unsubscribeCountChange = null;
    }
    if (this.unsubscribeControlAttached) {
      this.unsubscribeControlAttached();
      this.unsubscribeControlAttached = null;
    }
  }

  deselectAllBaseMaps(exceptIdx: number) {
    const inputs = this.uiContainer.querySelectorAll(
      `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.COLOR_ITEM}) input`,
    ) as NodeListOf<HTMLInputElement>;
    let changed = false;
    for (let i = 0; i < this.m.layers.length; i++) {
      if (this.m.layers[i].isBase && i !== exceptIdx) {
        const bLayer = this.m.findLayer(this.m.layers[i]);
        if (bLayer && this.m.map.hasLayer(bLayer)) {
          this.m.map.removeLayer(bLayer);
          changed = true;
        }
        if (inputs[i]) {
          if (inputs[i].checked) {
            inputs[i].checked = false;
            inputs[i]
              .closest(CONST.SEL.LAYER_ITEM)
              ?.classList.remove(CONST.CLASSES.ACTIVE);
            changed = true;
          }
        }
      }
    }
    // Excluded from handleChange: it is the mutual-exclusion half of that
    // handler, so walking it would recurse. The bases it deselects are hidden
    // by the user's own choice, so they still need to persist -- otherwise a
    // reload re-checks them and the "only one base at a time" invariant
    // silently resets. The selected base is already tracked by the caller.
    if (changed) {
      for (let i = 0; i < this.m.layers.length; i++) {
        if (this.m.layers[i].isBase && i !== exceptIdx) {
          this.syncHiddenId(this.m.layers[i].id, true);
        }
      }
    }
  }

  // ── delegates: state ──
  loadPersistedState() {
    return loadPersistedState(this);
  }
  saveFoldState() {
    return saveFoldState(this);
  }
  saveHiddenIds() {
    return saveHiddenIds(this);
  }
  applyUserState(id?: string) {
    return applyUserState(this, id);
  }
  applyHiddenOne(layerInfo: LayerInfo, layerId: string) {
    return applyHiddenOne(this, layerInfo, layerId);
  }
  applyHiddenStateOne(layerInfo: LayerInfo) {
    return applyHiddenStateOne(this, layerInfo);
  }
  applyVisibleStateOne(layerInfo: LayerInfo) {
    return applyVisibleStateOne(this, layerInfo);
  }
  reconcileHiddenIds() {
    return reconcileHiddenIds(this);
  }
  saveNamesState() {
    return saveNamesState(this);
  }
  syncHiddenId(id: string, hidden: boolean, persist: boolean = true) {
    return syncHiddenId(this, id, hidden, persist);
  }

  // ── delegates: list ──
  initTypesAndVisibility() {
    return initTypesAndVisibility(this);
  }
  renderInitialList() {
    return renderInitialList(this);
  }
  insertLayerItem(layerInfo: LayerInfo, opts?: { reindex?: boolean }) {
    return insertLayerItem(this, layerInfo, opts);
  }
  updateLayerItem(layerInfo: LayerInfo, idx: number) {
    return updateLayerItem(this, layerInfo, idx);
  }
  displayName(layerId: string) {
    return displayName(this, layerId);
  }
  renderToggleAllRow(group: string, labelKey: string) {
    return renderToggleAllRow(this, group, labelKey);
  }
  renderLayerItem(layerInfo: LayerInfo, idx: number) {
    return renderLayerItem(this, layerInfo, idx);
  }
  colorLayerName() {
    return colorLayerName(this);
  }
  renderColorLayerItem() {
    return renderColorLayerItem(this);
  }
  initLayerItem(layerInfo: LayerInfo) {
    return initLayerItem(this, layerInfo);
  }
  reindexItems() {
    return reindexItems(this);
  }
  reindexAfterMove() {
    return reindexAfterMove(this);
  }

  // ── delegates: visibility ──
  getLayerItems(group: string) {
    return getLayerItems(this, group);
  }
  toggleAll(group: string, newState: boolean) {
    return toggleAll(this, group, newState);
  }
  syncToggleAll(group: string) {
    return syncToggleAll(this, group);
  }
  syncVisibility(layerInfo: LayerInfo, layer: L.Layer | null, fallback: boolean) {
    return syncVisibility(this, layerInfo, layer, fallback);
  }
  handleChange(event: Event) {
    return handleChange(this, event);
  }
  handleInput(event: Event) {
    return handleInput(this, event);
  }

  // ── delegates: keyboard ──
  getNavigableItems() {
    return getNavigableItems(this);
  }
  findVisibleNeighbor(items: HTMLElement[], from: number, dir: 1 | -1) {
    return findVisibleNeighbor(this, items, from, dir);
  }
  getActiveLayerItem() {
    return getActiveLayerItem(this);
  }
  setActiveItem(index: number) {
    return setActiveItem(this, index);
  }
  moveActiveMarker(item: HTMLElement | null, items: HTMLElement[]) {
    return moveActiveMarker(this, item, items);
  }
  blurActiveItem() {
    return blurActiveItem(this);
  }
  clearActiveItem() {
    return clearActiveItem(this);
  }
  handleOutsideMousedown(event: MouseEvent) {
    return handleOutsideMousedown(this, event);
  }
  resolveActiveIdx(items: HTMLElement[]) {
    return resolveActiveIdx(this, items);
  }
  syncActiveItem() {
    return syncActiveItem(this);
  }
  syncListCursor() {
    return syncListCursor(this);
  }
  cursorRef() {
    return cursorRef(this);
  }
  restoreCursor(ref: string | null) {
    return restoreCursor(this, ref);
  }
  handleKeyDown(event: KeyboardEvent) {
    return handleKeyDown(this, event);
  }
  escapeClearCursor() {
    return escapeClearCursor(this);
  }
  focusLayerRow(layerId: string) {
    return focusLayerRow(this, layerId);
  }
  handleDblClick(event: MouseEvent) {
    return handleDblClick(this, event);
  }

  // ── delegates: drag ──
  toggleFold(group: string) {
    return toggleFold(this, group);
  }
  handleDragStart(event: DragEvent) {
    return handleDragStart(this, event);
  }
  showReorderBlockedHint() {
    return showReorderBlockedHint(this);
  }
  handleDragOver(event: DragEvent) {
    return handleDragOver(this, event);
  }
  handleDragLeave(event: DragEvent) {
    return handleDragLeave(this, event);
  }
  handleDrop(event: DragEvent) {
    return handleDrop(this, event);
  }
  handleDragEnd() {
    return handleDragEnd(this);
  }

  // ── delegates: color / menu / attrs / rename / focus ──
  showColorLayer(color: string) {
    return showColorLayer(this, color);
  }
  hideColorLayer() {
    return hideColorLayer(this);
  }
  openMoreMenu(item: HTMLElement) {
    return openMoreMenu(this, item);
  }
  closeMoreMenu(setFocus: boolean) {
    return closeMoreMenu(this, setFocus);
  }
  openAttrsPanel(item: HTMLElement) {
    return openAttrsPanel(this, item);
  }
  closeAttrsPanel(setFocus: boolean) {
    return closeAttrsPanel(this, setFocus);
  }
  renameLayer(layerId: string) {
    return renameLayer(this, layerId);
  }
  finishRename(cancel?: boolean) {
    return finishRename(this, cancel);
  }
  showBaseFocusHint() {
    return showBaseFocusHint(this);
  }
  isFocusLayerDisabled(item: HTMLElement) {
    return isFocusLayerDisabled(this, item);
  }
  toggleFocusedLayer() {
    return toggleFocusedLayer(this);
  }
  focusLayer(layerId: string) {
    return focusLayer(this, layerId);
  }
  isFocusing() {
    return isFocusing(this);
  }
  cancelFocus() {
    return cancelFocus(this);
  }
  dismissFocus() {
    return dismissFocus(this);
  }

  // ── focus helpers (also used internally by focus.ts) ──
  /** Every registered layer is linked to a Leaflet layer (findLayer resolvable).
   *  False during the first post-attach pass, when folium layers may not be in
   *  the registry yet. */
  allLayersResolved(): boolean {
    return this.m.layers.every(li => this.m.findLayer(li) != null);
  }
  computeLayerBounds(layer: L.Layer) {
    return computeLayerBounds(this, layer);
  }
  hideOtherLayers() {
    return hideOtherLayers(this);
  }
  bringFocusedLayerToFront(layer: L.Layer | null, canvas: HTMLCanvasElement | null) {
    return bringFocusedLayerToFront(this, layer, canvas);
  }
  highlightFocusedRow(itemEl: HTMLElement | null, layerId: string) {
    return highlightFocusedRow(this, itemEl, layerId);
  }
  registerAutoCancel(layerId: string) {
    return registerAutoCancel(this, layerId);
  }
  drawFocusMask(bounds: L.LatLngBounds) {
    return drawFocusMask(this, bounds);
  }
  drawFocusRect(bounds: L.LatLngBounds) {
    return drawFocusRect(this, bounds);
  }
  clearAutoCancel() {
    return clearAutoCancel(this);
  }
  clearFocusedRowHighlight() {
    return clearFocusedRowHighlight(this);
  }
  restoreHiddenLayers() {
    return restoreHiddenLayers(this);
  }
}

export { LayerUI };
