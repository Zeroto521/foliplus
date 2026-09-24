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
  applyZoomRangeStateOne,
  dropPersistedLayerState,
  loadPersistedState,
  refreshZoomEffectiveShown,
  replayLayerState,
  saveFoldState,
  saveNamesState,
  saveState,
  syncHiddenId,
} from "./state.js";
import {
  applyStyleLabelState,
  closeStylePanel,
  invalidateFields,
  openStylePanel,
} from "./style/index.js";
import {
  applyVisibility,
  getLayerItems,
  handleChange,
  handleInput,
  syncToggleAll,
  syncVisibility,
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
  /** Layer ids the zoom-range mechanism itself removed from the map in this
   *  session (derived state, never persisted). The one-way gate: this is the
   *  *only* set of ids the range is allowed to put back on the map — a layer
   *  the author declared `show=False` and the user never touched has no
   *  entry here, so the range stays off the map the way folium left it.
   *
   *  Any explicit user action clears the id via `syncHiddenId`, so the
   *  user's choice always beats this mechanism's record. */
  rangeHiddenIds: Set<string>;
  /** The author's declared default per layer id, snapshotted once per id from
   *  the map membership at first sight.
   *
   *  Folium ships the layer list without a visibility field, so the author's
   *  `show=` default reaches the UI only as the map state folium left behind
   *  when the panel boots. It must be captured before the policy starts moving
   *  layers: `layerInfo.visible` is a real-time mirror that applyLayerState and
   *  the zoom-range sweep both write, so by the time a row first paints it
   *  already carries a policy decision, not the author's. See `rowChecked`. */
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
  declare onKeyDown: ((event: KeyboardEvent) => void) | null;
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
    this.rangeHiddenIds = new Set();
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
    this.styleRefresh = null;
    this.styleZoomEndHandler = null;
    this.stylePanelLayerId = null;
    this.fieldCache = new Map();
    this.pressInPanel = false;
    this.labelConfigs = {};
    this.opacityMap = {};
    this.zoomRangeMap = {};
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
  syncHiddenId(id: string, hidden: boolean, persist: boolean = true) {
    return syncHiddenId(this, id, hidden, persist);
  }
  saveState() {
    return saveState(this);
  }
  applyUserState(id?: string) {
    return applyUserState(this, id);
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
  /** Re-evaluate every layer's effective-shown after a zoom change or a
   *  focus transition. Writes through the single pipeline (`applyLayerState`),
   *  so `hiddenIds` / `overrides` / the checkbox DOM are never touched —
   *  the #329 lock. */
  refreshZoomEffectiveShown() {
    return refreshZoomEffectiveShown(this);
  }
  applyZoomRangeStateOne(layerId: string, range: [number, number] | null) {
    const layerInfo = this.m.layerRegistry.get(layerId);
    if (layerInfo) applyZoomRangeStateOne(this, layerInfo, range);
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
  syncVisibility(layerInfo: LayerInfo, layer: L.Layer | null, fallback: boolean) {
    return syncVisibility(this, layerInfo, layer, fallback);
  }
  applyVisibility(id: string, visible: boolean) {
    return applyVisibility(this, id, visible);
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
