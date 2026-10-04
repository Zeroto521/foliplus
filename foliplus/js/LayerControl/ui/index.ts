// LayerControl UI — class shell: state, lifecycle, event wiring, delegates.
// Heavy lifting lives in `ui/*` modules; this class owns state and delegates.
import { type EventBus, ensureEvents } from "#core/event/index.js";
import {
  type CreateColorAPI,
  type LayerInfo,
  LayerIntentStore,
  LayerRuntimeStore,
} from "#core/layer/index.js";
import { ListCursor } from "#core/listCursor.js";
import * as CONST from "../const.js";
import type { LayerManager } from "../manager.js";
import { applyProjection, applyProjectionAll } from "./apply.js";
import { closeAttrsPanel, openAttrsPanel } from "./attr.js";
import { hideSolidBasemap, resetSolidBasemap, showSolidBasemap } from "./color.js";
import { cancelFocus, focusLayer, isFocusing } from "./focus.js";
import { FocusController } from "./focusController.js";
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
import { ListPanel } from "./listPanel.js";
import { closeMoreMenu, openMoreMenu } from "./menu.js";
import { OverlayPanel } from "./overlayPanel.js";
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
import { dropStyleDimApplies } from "./style/styleBag.js";
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

// Per-instance injection seam — LayerControl passes the env it owns; tests
// construct LayerUI without one and fall back to identity translators so the
// module stays free of any CONFIG reference at load time.
const NO_OP_ENV: { T: (key: string) => string; _: (key: string) => string } = {
  T: key => `LayerControl.${key}`,
  _: key => key,
};

/** UI Controller for LayerControl.

 *  Per-panel state lives on one of three view subsystems:
 *  - listPanel:        fold state, cursor index, drag state
 *  - overlayPanel:     floating panels (menu / attrs / rename / style)
 *  - focusController:  focus spotlight + inverse mask
 *
 *  Cross-cutting code reads state via compat getters (`ui.foldedGroups`)
 *  so a test that builds a mock `ui` object does not need to know about the
 *  subsystem split. The getters are thin redirections; each subsystem owns
 *  the actual field.
 */
class LayerUI {
  manager: LayerManager;
  /** Per-map event bus — bound once in the constructor (ensure-style getters
   *  return the cached instance, so hold it like the logger does). */
  events: EventBus;
  /** Component config — carried on the instance so the ui/* modules read it
   *  from `ui.config` instead of a module-level free variable. */
  config: ComponentConfig;
  /** Translator bound to `config`, forwarded from the module const. */
  T: (key: string) => string;
  /** Unscoped translator for the shared `foliplus.*` vocabulary (the label
   *  controls the style panel shares with HeatmapControl). Kept beside `T` so
   *  a test can inject either independently. */
  _: (key: string) => string;
  /** View subsystem: row layout state (fold, cursor, drag). */
  listPanel: ListPanel;
  /** View subsystem: floating panels (menu / attrs / rename / style). */
  overlayPanel: OverlayPanel;
  /** View subsystem: focus spotlight + inverse mask. */
  focusController: FocusController;
  /** Per-layer intent store — the single source for every user-chosen
   *  dimension (visible / fill / border / opacity / zoomRange / name /
   *  annotation). Absent key = never touched. Provenance rides the same
   *  `IntentRow` beside the values (`IntentRow.provenance`). */
  intentStore: LayerIntentStore;
  /** Per-layer derived/transient state — the runtime half of the base:
   *  projection last-write, field cache, author-visible snapshot. Mirrors the
   *  intent store row shape (Map by id, O(1)); dropped symmetrically with the
   *  intent row on unregister (see `LayerRuntimeStore`). */
  runtimeStore: LayerRuntimeStore;
  currentColor: string;
  /** Lazy-created color basemap surface — the pane-owned canvas that carries
   *  the fill. Built on first show (via `factory.createColor`), which also
   *  upserts the LayerInfo so the pane participates in `enforceOrder`.
   *  Null until the color basemap is first displayed. */
  colorSurface: CreateColorAPI | null;
  /** Compat getter — real state lives on `listPanel.foldedGroups`. */
  get foldedGroups(): Set<string> {
    return this.listPanel.foldedGroups;
  }
  set foldedGroups(v: Set<string>) {
    this.listPanel.foldedGroups = v;
  }
  /** Compat getter — real state lives on `listPanel.checkedCount`. */
  get checkedCount(): Record<string, { total: number; on: number }> {
    return this.listPanel.checkedCount;
  }
  set checkedCount(v: Record<string, { total: number; on: number }>) {
    this.listPanel.checkedCount = v;
  }
  /** Compat getter — real state lives on `listPanel.activeRenameId`. */
  get activeRenameId(): string | null {
    return this.overlayPanel.activeRenameId;
  }
  set activeRenameId(v: string | null) {
    this.overlayPanel.activeRenameId = v;
  }
  /** Compat getter — real state lives on `listPanel.dragIdx`. */
  get dragIdx(): number | null {
    return this.listPanel.dragIdx;
  }
  set dragIdx(v: number | null) {
    this.listPanel.dragIdx = v;
  }
  /** Compat getter — real state lives on `listPanel.lastDragHintAt`. */
  get lastDragHintAt(): number {
    return this.listPanel.lastDragHintAt;
  }
  set lastDragHintAt(v: number) {
    this.listPanel.lastDragHintAt = v;
  }
  /** Compat getter — real state lives on `listPanel.lastDragOverItem`. */
  get lastDragOverItem(): HTMLElement | null {
    return this.listPanel.lastDragOverItem;
  }
  set lastDragOverItem(v: HTMLElement | null) {
    this.listPanel.lastDragOverItem = v;
  }
  /** Compat getter — real state lives on `listPanel.activeIdx`. */
  get activeIdx(): number | null {
    return this.listPanel.activeIdx;
  }
  set activeIdx(v: number | null) {
    this.listPanel.activeIdx = v;
  }
  /** Compat getter — real state lives on `listPanel.listCursor`. */
  get listCursor(): ListCursor | null {
    return this.listPanel.listCursor;
  }
  set listCursor(v: ListCursor | null) {
    this.listPanel.listCursor = v;
  }
  /** Compat getter — real state lives on `listPanel.interactionCleanup`. */
  get interactionCleanup(): (() => void) | undefined {
    return this.listPanel.interactionCleanup;
  }
  set interactionCleanup(v: (() => void) | undefined) {
    this.listPanel.interactionCleanup = v;
  }
  /** Cleanup for the geometry-focus marquee (focusin/focusout). */
  geometryMarqueeCleanup?: (() => void) | null;
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
   *  intents.visible / overrides. */
  onZoomEnd: (() => void) | null;
  /** Unsubscribe function for LAYER_ITEM_COUNT_CHANGE. */
  unsubscribeCountChange: (() => void) | null;
  /** Unsubscribe for the control-attached ready signal. */
  unsubscribeControlAttached: (() => void) | null;
  /** Unsubscribers for the manager-driven layer-signal events (item add /
   *  update / refresh, list rebuild, group count change, no-basemap
   *  change, content invalidation). Batched into one array so a single
   *  unbind call tears down every listener; the manager no longer drives
   *  these UI methods directly. */
  unsubscribeLayerSignals: Array<() => void>;
  /** Compat getter — real state lives on `overlayPanel.activeMenu`. */
  get activeMenu(): {
    item: HTMLElement;
    menu: HTMLElement;
    layerId: string;
  } | null {
    return this.overlayPanel.activeMenu;
  }
  set activeMenu(
    v: {
      item: HTMLElement;
      menu: HTMLElement;
      layerId: string;
    } | null,
  ) {
    this.overlayPanel.activeMenu = v;
  }
  /** Compat getter — real state lives on `overlayPanel.activeAttrsPanel`. */
  get activeAttrsPanel(): {
    item: HTMLElement;
    panel: HTMLElement;
    layerId: string;
  } | null {
    return this.overlayPanel.activeAttrsPanel;
  }
  set activeAttrsPanel(
    v: {
      item: HTMLElement;
      panel: HTMLElement;
      layerId: string;
    } | null,
  ) {
    this.overlayPanel.activeAttrsPanel = v;
  }
  /** Compat getter — real state lives on `overlayPanel.attrsOutsideHandler`. */
  get attrsOutsideHandler(): ((event: MouseEvent) => void) | null {
    return this.overlayPanel.attrsOutsideHandler;
  }
  set attrsOutsideHandler(v: ((event: MouseEvent) => void) | null) {
    this.overlayPanel.attrsOutsideHandler = v;
  }
  /** Compat getter — real state lives on `overlayPanel.styleOutsideHandler`. */
  get styleOutsideHandler(): ((event: MouseEvent) => void) | null {
    return this.overlayPanel.styleOutsideHandler;
  }
  set styleOutsideHandler(v: ((event: MouseEvent) => void) | null) {
    this.overlayPanel.styleOutsideHandler = v;
  }
  /** Compat getter — real state lives on `overlayPanel.attrsUnsubscribe`. */
  get attrsUnsubscribe(): (() => void) | null {
    return this.overlayPanel.attrsUnsubscribe;
  }
  set attrsUnsubscribe(v: (() => void) | null) {
    this.overlayPanel.attrsUnsubscribe = v;
  }
  /** Compat getter — real state lives on `overlayPanel.styleUnsubscribe`. */
  get styleUnsubscribe(): (() => void) | null {
    return this.overlayPanel.styleUnsubscribe;
  }
  set styleUnsubscribe(v: (() => void) | null) {
    this.overlayPanel.styleUnsubscribe = v;
  }
  /** Compat getter — real state lives on `overlayPanel.styleRefresh`. */
  get styleRefresh(): (() => void) | null {
    return this.overlayPanel.styleRefresh;
  }
  set styleRefresh(v: (() => void) | null) {
    this.overlayPanel.styleRefresh = v;
  }
  /** Compat getter — real state lives on `overlayPanel.styleZoomEndHandler`. */
  get styleZoomEndHandler(): (() => void) | null {
    return this.overlayPanel.styleZoomEndHandler;
  }
  set styleZoomEndHandler(v: (() => void) | null) {
    this.overlayPanel.styleZoomEndHandler = v;
  }
  /** Compat getter — real state lives on `overlayPanel.stylePanelLayerId`. */
  get stylePanelLayerId(): string | null {
    return this.overlayPanel.stylePanelLayerId;
  }
  set stylePanelLayerId(v: string | null) {
    this.overlayPanel.stylePanelLayerId = v;
  }
  /** Compat getter — real state lives on `listPanel.pressInPanel`. */
  get pressInPanel(): boolean {
    return this.listPanel.pressInPanel;
  }
  set pressInPanel(v: boolean) {
    this.listPanel.pressInPanel = v;
  }

  constructor(
    manager: LayerManager,
    env: { T: (key: string) => string; _: (key: string) => string } = NO_OP_ENV,
  ) {
    this.manager = manager;
    this.events = ensureEvents(this.m.map);
    this.config = CONFIG;
    this.T = env.T;
    this._ = env._;
    this.listPanel = new ListPanel(manager, this.events, env);
    this.overlayPanel = new OverlayPanel(manager, this.events, env);
    this.focusController = new FocusController(manager, this.events, env);
    this.intentStore = new LayerIntentStore();
    this.runtimeStore = new LayerRuntimeStore();
    this.currentColor = CONST.COLOR.DEFAULT;
    this.colorSurface = null;
    this.unsubscribeCountChange = null;
    this.unsubscribeControlAttached = null;
    this.unsubscribeLayerSignals = [];
    this.onMoreClick = null;
    this.onMoreMenuClick = null;
    this.onMoreMapClick = null;
    this.onZoomEnd = null;
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
    return loadPersistedState(this.listPanel, this);
  }
  saveFoldState() {
    return saveFoldState(this.listPanel, this);
  }
  setVisible(id: string, visible: boolean, persist: boolean = true) {
    return setVisible(this.listPanel, this, id, visible, persist);
  }
  saveState() {
    return saveState(this.listPanel, this);
  }
  applyUserState(id?: string) {
    applyUserState(this.listPanel, this, id);
    // The executor carries visible / opacity / zoomRange only. Border and
    // fill are direct setStyle writes, so without their own replay a reload
    // would restore the drawer's swatch while the map kept the author's
    // values. Hooked here rather than in state.ts to keep state.ts free of
    // style-row imports (border.js and fill.js import state.js for
    // markOverride/saveState).
    //
    // Both dimensions enumerate provenance — the single source of truth
    // for which layers the user actually touched. Border's map-union
    // enumeration and fill's provenance loop were asymmetric: a value in
    // `intent.borderColor` that was never recorded as an override would replay
    // for border but not for fill, and vice versa, so a reload could restore
    // the drawer's swatch for one dimension while leaving the map with the
    // author's for the other.
    const layerIds = id !== undefined ? [id] : this.intentStore.userSetIds();
    for (const layerId of layerIds) {
      applyBorderToLayer(this.overlayPanel, this, layerId);
      replayFillState(this.overlayPanel, this, layerId);
    }
  }
  dropPersistedLayerState(layerId: string) {
    return dropPersistedLayerState(this.listPanel, this, layerId);
  }
  saveNamesState() {
    return saveNamesState(this.listPanel, this);
  }
  // ── delegates: list ──
  initTypesAndVisibility() {
    return initTypesAndVisibility(this.listPanel, this);
  }
  renderInitialList() {
    return renderInitialList(this.listPanel, this);
  }
  insertLayerItem(layerInfo: LayerInfo) {
    return insertLayerItem(this.listPanel, this, layerInfo);
  }
  updateLayerItem(layerInfo: LayerInfo) {
    return updateLayerItem(this.listPanel, this, layerInfo);
  }
  colorLayerName() {
    return colorLayerName(this.listPanel, this);
  }
  displayName(id: string) {
    return displayName(this.listPanel, this, id);
  }
  initLayerItem(layerInfo: LayerInfo) {
    return initLayerItem(this.listPanel, this, layerInfo);
  }
  reindexAfterMove() {
    return reindexAfterMove(this.listPanel, this);
  }

  // ── delegates: visibility ──
  getLayerItems(group: string) {
    return getLayerItems(this.listPanel, this, group);
  }
  toggleAll(group: string, newState: boolean) {
    return toggleAll(this.listPanel, this, group, newState);
  }
  syncToggleAll(group: string) {
    return syncToggleAll(this.listPanel, this, group);
  }
  syncToggleAllFromCount(group: string) {
    return syncToggleAllFromCount(this.listPanel, this, group);
  }
  syncNoBasemap() {
    return syncNoBasemap(this.listPanel, this);
  }
  applyVisibility(id: string, visible: boolean) {
    return applyVisibility(this.listPanel, this, id, visible);
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
    return handleChange(this.listPanel, this, event);
  }
  handleInput(event: Event) {
    return handleInput(this.listPanel, this, event);
  }

  // ── delegates: keyboard ──
  getNavigableItems() {
    return getNavigableItems(this.listPanel, this);
  }
  setActiveItem(index: number) {
    return setActiveItem(this.listPanel, this, index);
  }
  blurActiveItem() {
    return blurActiveItem(this.listPanel, this);
  }
  clearActiveItem() {
    return clearActiveItem(this.listPanel, this);
  }
  handleOutsideMousedown(event: MouseEvent) {
    return handleOutsideMousedown(this.listPanel, this, event);
  }
  handleKeyDown(event: KeyboardEvent) {
    return handleKeyDown(this.listPanel, this, event);
  }
  handleDblClick(event: MouseEvent) {
    return handleDblClick(this.listPanel, this, event);
  }

  // ── delegates: color / menu / attrs / rename / focus ──
  showSolidBasemap(color: string) {
    return showSolidBasemap(this.listPanel, this, color);
  }
  hideSolidBasemap() {
    return hideSolidBasemap(this.listPanel, this);
  }
  resetSolidBasemap() {
    return resetSolidBasemap(this.listPanel, this);
  }
  openMoreMenu(item: HTMLElement) {
    return openMoreMenu(this.overlayPanel, this, item);
  }
  closeMoreMenu(setFocus: boolean) {
    return closeMoreMenu(this.overlayPanel, this, setFocus);
  }
  openAttrsPanel(item: HTMLElement) {
    return openAttrsPanel(this.overlayPanel, this, item);
  }
  closeAttrsPanel(setFocus: boolean) {
    return closeAttrsPanel(this.overlayPanel, this, setFocus);
  }
  openStylePanel(layerId: string) {
    return openStylePanel(this.overlayPanel, this, layerId);
  }
  closeStylePanel(setFocus: boolean) {
    return closeStylePanel(this.overlayPanel, this, setFocus);
  }
  /** Part of the surface `manager` drives (`unregisterLayer` drops a layer's
   *  cached field list). Peer ui/ modules call the module function directly
   *  instead — see the sibling-import convention from #296. */
  invalidateFields(layerId: string) {
    return invalidateFields(this.overlayPanel, this, layerId);
  }
  /** Unregister teardown for the style-apply schedulers: cancel any pending
   *  rAF walk and free the Map entries (both faces in one pass) so a
   *  churning map cannot accumulate boxes keyed by dead ids. Manager drives
   *  this from `unregisterLayer` — the single drop hook. */
  dropStyleDimApplies(layerId: string) {
    return dropStyleDimApplies(layerId);
  }
  /** Spy-sensitive entry point: the CONTROL_ATTACHED re-entry test asserts this
   *  ran, and `vi.spyOn` needs a method on the instance (an imported function
   *  is captured at load time). Kept for the same reason #296 kept the menu
   *  and rename hubs. */
  applyStyleLabelState() {
    return applyStyleLabelState(this.overlayPanel, this);
  }
  renameLayer(layerId: string) {
    return renameLayer(this.overlayPanel, this, layerId);
  }
  finishRename(cancel?: boolean) {
    return finishRename(this.overlayPanel, this, cancel);
  }
  focusLayer(layerId: string) {
    return focusLayer(this.focusController, this, layerId);
  }
  isFocusing() {
    return isFocusing(this.focusController, this);
  }
  cancelFocus() {
    return cancelFocus(this.focusController, this);
  }
  // ── focus helpers (also used internally by focus.ts) ──
}

export { LayerUI };
