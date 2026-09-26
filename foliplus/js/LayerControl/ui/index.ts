// LayerControl UI — class shell: state, lifecycle, event wiring, delegates.
// Heavy lifting lives in `ui/*` modules; this class owns state and delegates.
// attachUI / bindEvents / unbindEvents / onLayerItemCountChange /
// refreshAllCounts moved to `./lifecycle.ts` (34.2).
import { type EventBus, ensureEvents } from "#core/event/index.js";
import type { LabelField } from "#core/labelField.js";
import { type LayerInfo } from "#core/layer/index.js";
import { ListCursor } from "#core/listCursor.js";
import { createScopedTranslator, createTranslator } from "#common/locale.js";
import * as CONST from "../const.js";
import type { LayerManager } from "../manager.js";
import type { LayerOverride } from "../persistence.js";
import { applyProjection, applyProjectionAll } from "./apply.js";
import { closeAttrsPanel, openAttrsPanel } from "./attr.js";
import { hideColorLayer, showColorLayer } from "./color.js";
import { cancelFocus, focusLayer, isFocusing } from "./focus.js";
import {
  blurActiveItem,
  clearActiveItem,
  getNavigableItems,
  handleDblClick,
  handleKeyDown,
  handleOutsideMousedown,
  setActiveItem,
} from "./keyboard.js";
import {
  attachUI,
  bindEvents,
  onLayerItemCountChange,
  refreshAllCounts,
  unbindEvents,
} from "./lifecycle.js";
import {
  colorLayerName,
  initLayerItem,
  initTypesAndVisibility,
  insertLayerItem,
  reindexAfterMove,
  renderInitialList,
  updateLayerItem,
} from "./list.js";
import { closeMoreMenu, openMoreMenu } from "./menu.js";
import { finishRename, renameLayer } from "./rename.js";
import { applyRowView, buildRowCell, displayName, rowChecked } from "./rowView.js";
import {
  applyUserState,
  dropPersistedLayerState,
  loadPersistedState,
  replayLayerState,
  saveFoldState,
  saveNamesState,
  saveState,
  syncHiddenId,
} from "./state.js";
import type { AppliedProjection } from "./store.js";
import { replayBorderState } from "./style/border.js";
import {
  applyStyleLabelState,
  closeStylePanel,
  invalidateFields,
  openStylePanel,
  replayFillState,
} from "./style/index.js";
import {
  applyVisibility,
  getLayerItems,
  handleChange,
  handleInput,
  syncToggleAll,
  toggleAll,
} from "./visibility.js";

/** UI Controller for LayerControl. */
class LayerUI {
  manager: LayerManager;
  /** Per-map event bus — bound once in the constructor (ensure-style getters
   *  return the cached instance, so hold it like the logger does). */
  events: EventBus;
  /** Component config — carried on the instance so the ui/* modules read it
   *  from `ui.conf` instead of a module-level free variable. */
  conf: ComponentConfig;
  /** Translator bound to `conf`, created once in the constructor. */
  T: (key: string) => string;
  /** Unscoped translator for the shared `foliplus.*` vocabulary (the label
   *  controls the style panel shares with HeatmapControl). Kept beside `T` so
   *  a test can inject either independently. */
  _: (key: string) => string;
  foldedGroups: Set<string>;
  /** Layer ids hidden by the user (checked-off); survives page reload. */
  hiddenIds: Set<string>;
  /** The author's declared default per layer id, snapshotted once per id from
   *  the map membership at first sight.
   *
   *  Folium ships the layer list without a visibility field, so the author's
   *  `show=` default reaches the UI only as the map state folium left behind
   *  when the panel boots. It must be captured before the policy starts moving
   *  layers: `layerInfo.visible` is a real-time mirror that the diff executor
   *  writes, so by the time a row first paints it can already carry a policy
   *  decision, not the author's. See `rowChecked`. */
  authorVisible: Map<string, boolean>;
  /** Which dimensions the user has actually set, per layer id. A layer absent
   *  here keeps the author's `show=` / opacity default -- that is what replaces
   *  a map-level "did the user choose at all" flag, which could not tell one
   *  layer's choice from another's. */
  userOverrides: Record<string, LayerOverride[]>;
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
  interactionCleanup?: () => void;
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
  /** Click handler for the "more" (⋮) button. */
  onMoreClick: ((event: Event) => void) | null;
  /** Click handler for the dropdown menu items. */
  onMoreMenuClick: ((event: Event) => void) | null;
  /** Listen-map handler to detect clicks outside the open menu. */
  onMoreMapClick: ((event: L.LeafletEvent) => void) | null;
  /** Map zoomend handler — re-evaluates every layer's effective-shown after
   *  a zoom change so a layer whose range excludes the new level is hidden
   *  (and vice versa). Writes through the single pipeline, never touches
   *  hiddenIds / overrides. */
  onZoomEnd: (() => void) | null;
  /** Unsubscribe function for LAYER_ITEM_COUNT_CHANGE. */
  unsubscribeCountChange: (() => void) | null;
  /** Unsubscribe for the control-attached ready signal. */
  unsubscribeControlAttached: (() => void) | null;
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
  /** Same capture-phase dismiss, for the style panel. */
  styleOutsideHandler: ((event: MouseEvent) => void) | null;
  /** Unsubscribe for LAYER_ITEM_COUNT_CHANGE while attrs panel is open. */
  attrsUnsubscribe: (() => void) | null;
  /** Unsubscribe for LAYER_STYLE_CHANGE while a delegated style panel is open. */
  styleUnsubscribe: (() => void) | null;
  /** Refresh function for the shared label controls (set by renderDelegatedStylePanel). */
  styleRefresh: (() => void) | null;
  /** Map zoomend handler for the open style panel's zoom-range row: moves the
   *  current-zoom marker and refreshes the out-of-range state. */
  styleZoomEndHandler: (() => void) | null;
  /** Layer id whose annotation style panel is open, or null. */
  stylePanelLayerId: string | null;
  /** Per-layer label-field cache (collectFields walks every feature). */
  fieldCache: Map<string, LabelField[]>;
  /** Whether the current press began inside a floating row panel. Written on
   *  the press (the panel's document-level capture handler) and read by
   *  `handleDragStart`: `dragstart` is dispatched on the draggable row, so the
   *  event itself cannot say where the press began. */
  pressInPanel: boolean;
  /** Persisted per-layer annotation configs, applied once layers resolve. */
  labelConfigs: Record<string, unknown>;
  /** Persisted per-layer opacity map (id → 0-1). Applied on load / late register. */
  opacityMap: Record<string, number>;
  /** Persisted per-layer zoom range the user moved the handles for
   *  (id → [minZoom, maxZoom]). Applied on load / late register. */
  zoomRangeMap: Record<string, [number, number]>;
  /** Persisted per-layer border color (id → hex). A self-managed dimension —
   *  not part of the executor's visible/opacity/zoomRange family; the border
   *  row in ui/style/border.ts writes through setStyle directly. */
  borderColorMap: Record<string, string>;
  /** Persisted per-layer border width (id → px), in the shared border bounds. */
  borderWeightMap: Record<string, number>;
  /** Persisted per-layer fill color (id → hex). A self-managed dimension —
   *  not part of the executor's visible/opacity/zoomRange family; the fill
   *  row in ui/style/fill.ts writes through setStyle directly. */
  fillColorMap: Record<string, string>;
  /** Persisted per-layer fill opacity (id → 0-1). Same self-managed dimension. */
  fillOpacityMap: Record<string, number>;
  /** The executor's last-write map: id → the projection `applyProjection`
   *  last wrote to the map. This is what makes the executor a diff, not a
   *  sweep — a changeless call re-projects, sees no delta, and calls no
   *  carrier. Keyed by id (not by `layerInfo` identity) so a re-register
   *  of the same id keeps its projection across the swap. */
  appliedState: Map<string, AppliedProjection>;
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
    this.events = ensureEvents(this.m.map);
    this.conf = CONF;
    this.T = createScopedTranslator(CONF);
    this._ = createTranslator(CONF);
    this.foldedGroups = new Set();
    this.hiddenIds = new Set();
    this.authorVisible = new Map();
    this.userOverrides = {};
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
    this.onZoomEnd = null;
    this.activeMenu = null;
    this.attrsOutsideHandler = null;
    this.styleOutsideHandler = null;
    this.styleUnsubscribe = null;
    this.attrsUnsubscribe = null;
    this.styleRefresh = null;
    this.styleZoomEndHandler = null;
    this.stylePanelLayerId = null;
    this.fieldCache = new Map();
    this.pressInPanel = false;
    this.labelConfigs = {};
    this.opacityMap = {};
    this.zoomRangeMap = {};
    this.borderColorMap = {};
    this.borderWeightMap = {};
    this.fillColorMap = {};
    this.fillOpacityMap = {};
    this.appliedState = new Map();
    this.focusRect = null;
    this.focusingLayerId = null;
    this.onFocusMapMove = null;
    this.focusMask = null;
    this.focusRenderer = null;
    this.focusedPaneRestores = [];
  }

  /** Alias for convenience */
  get m() {
    return this.manager;
  }

  /** The attached panel container. Only valid after attachUI(). */
  get uiContainer(): HTMLElement {
    return this.m.uiContainer!;
  }

  /** LayerAPI typed to expose getFeatureCount (LayerManager only). */
  get mgmt(): LayerManager & { getFeatureCount: (i: string) => number | null } {
    return this.m as LayerManager & { getFeatureCount: (i: string) => number | null };
  }

  /**
   * Attach UI to the given container div.
   * @param {HTMLElement} containerDiv - The panel-content div.
   */
  attachUI(containerDiv: HTMLElement) {
    return attachUI(this, containerDiv);
  }

  /** Load every persisted dimension in one call. */
  bindEvents() {
    return bindEvents(this);
  }

  /** Called when a layer's content changes (count or type may shift at runtime).
   *  Re-computes geometry type so a layer that mixes geometry through the
   *  createLayers API (Point + LineString, etc.) shows the correct icon,
   *  not the one cached at initial attach. */
  onLayerItemCountChange(id: string) {
    return onLayerItemCountChange(this, id);
  }

  /** Refresh count column for every overlay item (no title change). */
  refreshAllCounts() {
    return refreshAllCounts(this);
  }

  unbindEvents() {
    return unbindEvents(this);
  }

  deselectAllBaseMaps(exceptIdx: number) {
    // The rows carry their identity (data-layer-id): a saved order can place a
    // row elsewhere in the DOM than its position in the registry.
    const bases = this.m.layers.filter((li, i) => li.isBase && i !== exceptIdx);
    let changed = false;
    for (const layerInfo of bases) {
      const bLayer = this.m.findLayer(layerInfo);
      if (bLayer && this.m.map.hasLayer(bLayer)) {
        this.m.map.removeLayer(bLayer);
        changed = true;
      }
      if (rowChecked(this, layerInfo)) changed = true;
    }
    // Excluded from handleChange: it is the mutual-exclusion half of that
    // handler, so walking it would recurse. The bases it deselects are hidden
    // by the user's own choice, so they still need to persist -- otherwise a
    // reload re-checks them and the "only one base at a time" invariant
    // silently resets. The selected base is already tracked by the caller.
    if (changed) {
      for (const layerInfo of bases) {
        syncHiddenId(this, layerInfo.id, true);
        const item = this.uiContainer.querySelector(
          `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerInfo.id)}"]`,
        ) as HTMLElement | null;
        if (item) applyRowView(this, item, buildRowCell(this, layerInfo));
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
  syncHiddenId(id: string, hidden: boolean, persist: boolean = true) {
    return syncHiddenId(this, id, hidden, persist);
  }
  saveState() {
    return saveState(this);
  }
  applyUserState(id?: string) {
    applyUserState(this, id);
    // The executor carries visible / opacity / zoomRange only. Border and
    // fill are direct setStyle writes, so without their own replay a reload
    // would restore the drawer's swatch while the map kept the author's
    // values. Hooked here rather than in state.ts to keep state.ts free of
    // style-row imports (border.js and fill.js import state.js for
    // markOverride/saveState).
    //
    // Both dimensions enumerate `userOverrides` — the single source of truth
    // for which layers the user actually touched. Border's map-union
    // enumeration and fill's userOverrides loop were asymmetric: a value in
    // `borderColorMap` that was never recorded as an override would replay
    // for border but not for fill, and vice versa, so a reload could restore
    // the drawer's swatch for one dimension while leaving the map with the
    // author's for the other.
    const layerIds =
      id !== undefined ? [id] : Object.keys(this.userOverrides);
    for (const layerId of layerIds) {
      replayBorderState(this, layerId);
      replayFillState(this, layerId);
    }
  }
  replayLayerState(layerId: string) {
    return replayLayerState(this, layerId);
  }
  dropPersistedLayerState(layerId: string) {
    return dropPersistedLayerState(this, layerId);
  }
  saveNamesState() {
    return saveNamesState(this);
  }
  // ── delegates: list ──
  initTypesAndVisibility() {
    return initTypesAndVisibility(this);
  }
  renderInitialList() {
    return renderInitialList(this);
  }
  insertLayerItem(layerInfo: LayerInfo) {
    return insertLayerItem(this, layerInfo);
  }
  updateLayerItem(layerInfo: LayerInfo) {
    return updateLayerItem(this, layerInfo);
  }
  displayName(layerId: string) {
    return displayName(this, layerId);
  }
  colorLayerName() {
    return colorLayerName(this);
  }
  initLayerItem(layerInfo: LayerInfo) {
    return initLayerItem(this, layerInfo);
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
  applyVisibility(id: string, visible: boolean) {
    return applyVisibility(this, id, visible);
  }
  applyProjection(layerId: string) {
    return applyProjection(this, layerId);
  }
  applyProjectionAll() {
    return applyProjectionAll(this);
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
  setActiveItem(index: number) {
    return setActiveItem(this, index);
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
  handleKeyDown(event: KeyboardEvent) {
    return handleKeyDown(this, event);
  }
  handleDblClick(event: MouseEvent) {
    return handleDblClick(this, event);
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
  openStylePanel(layerId: string) {
    return openStylePanel(this, layerId);
  }
  closeStylePanel(setFocus: boolean) {
    return closeStylePanel(this, setFocus);
  }
  /** Part of the surface `manager` drives (`unregisterLayer` drops a layer's
   *  cached field list). Peer ui/ modules call the module function directly
   *  instead — see the sibling-import convention from #296. */
  invalidateFields(layerId: string) {
    return invalidateFields(this, layerId);
  }
  /** Spy-sensitive entry point: the CONTROL_ATTACHED re-entry test asserts this
   *  ran, and `vi.spyOn` needs a method on the instance (an imported function
   *  is captured at load time). Kept for the same reason #296 kept the menu
   *  and rename hubs. */
  applyStyleLabelState() {
    return applyStyleLabelState(this);
  }
  renameLayer(layerId: string) {
    return renameLayer(this, layerId);
  }
  finishRename(cancel?: boolean) {
    return finishRename(this, cancel);
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
  // ── focus helpers (also used internally by focus.ts) ──
}

export { LayerUI };
