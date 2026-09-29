// LayerControl UI — class shell: state, lifecycle, event wiring, delegates.
// Heavy lifting lives in `ui/*` modules; this class owns state and delegates.
import { type EventBus, ensureEvents } from "#core/event/index.js";
import type { LabelField } from "#core/labelField.js";
import { type CreateColorAPI, type LayerInfo } from "#core/layer/index.js";
import { ListCursor } from "#core/listCursor.js";
import { createScopedTranslator, createTranslator } from "#common/locale.js";
import * as CONST from "../const.js";
import type { LayerManager } from "../manager.js";
import type { LayerIntent, LayerOverride } from "../type.js";
import type { AppliedProjection } from "../type.js";
import { applyProjection, applyProjectionAll } from "./apply.js";
import { closeAttrsPanel, openAttrsPanel } from "./attr.js";
import { hideSolidBasemap, showSolidBasemap } from "./color.js";
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
import { intentVisibleOf } from "./projection.js";
import { finishRename, renameLayer } from "./rename.js";
import { applyRowView, buildRowCell, displayName } from "./rowView.js";
import {
  applyUserState,
  dropPersistedLayerState,
  loadPersistedState,
  saveFoldState,
  saveNamesState,
  saveState,
  setVisible,
} from "./state.js";
import { applyBorderToLayer } from "./style/border.js";
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
  syncNoBasemap,
  syncToggleAll,
  syncToggleAllFromCount,
  toggleAll,
} from "./visibility.js";

// One creation per rendered IIFE; instances only forward (`this.T = T`),
// keeping the per-instance injection seam the UI tests rely on.
const T = createScopedTranslator(CONF);
const _ = createTranslator(CONF);

/** UI Controller for LayerControl. */
class LayerUI {
  manager: LayerManager;
  /** Per-map event bus — bound once in the constructor (ensure-style getters
   *  return the cached instance, so hold it like the logger does). */
  events: EventBus;
  /** Component config — carried on the instance so the ui/* modules read it
   *  from `ui.conf` instead of a module-level free variable. */
  conf: ComponentConfig;
  /** Translator bound to `conf`, forwarded from the module const. */
  T: (key: string) => string;
  /** Unscoped translator for the shared `foliplus.*` vocabulary (the label
   *  controls the style panel shares with HeatmapControl). Kept beside `T` so
   *  a test can inject either independently. */
  _: (key: string) => string;
  foldedGroups: Set<string>;
  /** Per-group tri-state counts maintained incrementally so a single-row
   *  click is O(1). Populated by the full-scan `syncToggleAll` at reconcile
   *  points (attach, insert, delete, reload) and kept in sync by
   *  `bumpCheckedCount` on each single-row toggle. `total` is the row count
   *  `getLayerItems(group).length` returns; `on` is the subset whose intent
   *  is visible. `syncToggleAllFromCount` writes the checkbox off `on`. */
  checkedCount: Record<string, { total: number; on: number }>;
  /** Per-layer intent record — the single source for every user-chosen
   *  dimension (visible / fill / border / opacity / zoomRange / name /
   *  annotation). Absent key = never touched. `intentProvenance` stays a
   *  separate axis. The parallel maps below are migration mirrors kept in
   *  lockstep by `ui/intent.ts`. */
  intents: Record<string, LayerIntent>;
  /** Layer id → the user's own visibility choice (true = shown), absent when
   *  the user never chose; survives page reload. */
  visibleMap: Record<string, boolean>;
  /** The author's declared default per layer id, snapshotted once per id from
   *  the map membership at first sight.
   *
   *  Folium ships the layer list without a visibility field, so the author's
   *  `show=` default reaches the UI only as the map state folium left behind
   *  when the panel boots. It must be captured before the policy starts moving
   *  layers: by the time a row first paints a policy sweep may already have
   *  moved the layer off the map, and reading the map back would record that
   *  policy decision as the author's. See `intentVisibleOf`. */
  authorVisible: Map<string, boolean>;
  /** Which dimensions the user has actually set, per layer id. A layer absent
   *  here keeps the author's `show=` / opacity default -- that is what replaces
   *  a map-level "did the user choose at all" flag, which could not tell one
   *  layer's choice from another's. */
  intentProvenance: Record<string, LayerOverride[]>;
  currentColor: string;
  /** Lazy-created color basemap surface — the pane-owned canvas that carries
   *  the fill. Built on first show (via `factory.createColor`), which also
   *  upserts the LayerInfo so the pane participates in `enforceOrder`.
   *  Null until the color basemap is first displayed. */
  colorSurface: CreateColorAPI | null;
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
   *  visibleMap / overrides. */
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
    this.T = T;
    this._ = _;
    this.foldedGroups = new Set();
    this.checkedCount = {};
    this.intents = {};
    this.visibleMap = {};
    this.authorVisible = new Map();
    this.intentProvenance = {};
    this.currentColor = CONST.COLOR.DEFAULT;
    this.colorSurface = null;
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

  // ── delegates: state ──
  loadPersistedState() {
    return loadPersistedState(this);
  }
  saveFoldState() {
    return saveFoldState(this);
  }
  setVisible(id: string, visible: boolean, persist: boolean = true) {
    return setVisible(this, id, visible, persist);
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
    // Both dimensions enumerate `intentProvenance` — the single source of truth
    // for which layers the user actually touched. Border's map-union
    // enumeration and fill's intentProvenance loop were asymmetric: a value in
    // `borderColorMap` that was never recorded as an override would replay
    // for border but not for fill, and vice versa, so a reload could restore
    // the drawer's swatch for one dimension while leaving the map with the
    // author's for the other.
    const layerIds = id !== undefined ? [id] : Object.keys(this.intentProvenance);
    for (const layerId of layerIds) {
      applyBorderToLayer(this, layerId);
      replayFillState(this, layerId);
    }
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
  syncToggleAllFromCount(group: string) {
    return syncToggleAllFromCount(this, group);
  }
  syncNoBasemap() {
    return syncNoBasemap(this);
  }
  applyVisibility(id: string, visible: boolean) {
    return applyVisibility(this, id, visible);
  }
  /** The user's stored visibility choice for a layer id (persisted intent
   *  or the author's declared default). This is the panel checkbox's fact,
   *  not the map's membership — the projection's `effectiveShown` composes
   *  intent with policy and is what the map reflects. Only LayerManager
   *  (via the `intentVisible` API slot) and tests reach this through LayerUI;
   *  everything internal calls the module function directly. */
  intentVisible(id: string) {
    return intentVisibleOf(this, id);
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
  showSolidBasemap(color: string) {
    return showSolidBasemap(this, color);
  }
  hideSolidBasemap() {
    return hideSolidBasemap(this);
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
