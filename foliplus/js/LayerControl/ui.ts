import { EVENTS, ensureEvents } from "#core/event/index.js";
import { HINT_DURATION } from "#core/hint.js";
import {
  GEOM_TYPE,
  type LayerInfo,
  forEachLeaf,
  getGeometryType,
} from "#core/layer/index.js";
import { ensureModes, guardBlocked } from "#core/mode.js";
import { type Debounced, debounce } from "#common/debounce.js";
import {
  createInlineEditInput,
  dom,
  removeInlineEditInput,
  updateItemLabel,
} from "#common/dom.js";
import { formatNumber } from "#common/format.js";
import * as Icons from "#common/icon.js";
import { createScopedTranslator } from "#common/locale.js";
import { createLogger } from "#common/log.js";
import * as CONST from "./const.js";
import * as SVGs from "./icon.js";
import {
  handleMoreClick,
  handleMoreMenuClick,
  registerInteractions,
} from "./interaction.js";
import type { LayerManager } from "./manager.js";
import * as Util from "./util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONF);
const log = createLogger(CONF.name);
const mapContainer = map.getContainer();

/**
 * Push one persisted rename out to whatever projections of it exist.
 *
 * Shared by the whole-panel sweep and the targeted single-layer call so the
 * "skip unchanged" rule lives in exactly one place.
 */
const applyNameProjection = (
  layerInfo: LayerInfo | null,
  item: HTMLElement | null,
  name: string,
): void => {
  if (!layerInfo && !item) return;
  if (layerInfo && layerInfo.name !== name) layerInfo.name = name;
  updateItemLabel(item, name);
};

/** UI Controller for LayerControl. Handles DOM rendering, events, and drag-and-drop. */
class LayerUI {
  manager: LayerManager;
  foldedGroups: Set<string>;
  /** Layer ids hidden by the user (checked-off); survives page reload. */
  hiddenIds: Set<string>;
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
  /** Last row the pointer touched. Fallback for resolveActiveIdx, where
   *  document.activeElement may still name the row focused before the click. */
  clickedRow: HTMLElement | null;
  private interactionCleanup?: () => void;
  declare onChange: ((event: Event) => void) | null;
  declare onInput: ((event: Event) => void) | null;
  declare onClick: ((event: Event) => void) | null;
  declare onFocusIn: (() => void) | null;
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
  /** Currently visible overflow menu (or null). */
  activeMenu: {
    item: HTMLElement;
    menu: HTMLElement;
    layerId: string;
  } | null;
  /** Temporary Rectangle overlay drawn while a focus is in progress. */
  private focusRect: L.Layer | null;
  /** Layer id currently being focused, or null. */
  private focusingLayerId: string | null;
  /** One-shot map move/zoom handler that auto-cancels focus when the user navigates. */
  private onFocusMapMove: (() => void) | null;
  /** Inverse-mask polygon that dims everything outside the focused bounds. */
  private focusMask: L.Polygon | null;
  /** SVG renderer hosting the focus overlay (mask + rectangle). */
  private focusRenderer: L.SVG | null;
  /** Restore callbacks for pane z-indexes lifted to bring the focused layer
   *  to the front (cleared on cancel). */
  private focusedPaneRestores: Array<() => void>;

  constructor(manager: LayerManager) {
    this.manager = manager;
    this.foldedGroups = new Set();
    this.hiddenIds = new Set();
    this.isColorActive = false;
    this.currentColor = CONST.COLOR.DEFAULT;
    this.renamedNames = {};
    this.activeRenameId = null;
    this.dragIdx = null;
    this.lastDragHintAt = 0;
    this.lastDragOverItem = null;
    this.activeIdx = null;
    this.clickedRow = null;
    this.unsubscribeCountChange = null;
    this.onMoreClick = null;
    this.onMoreMenuClick = null;
    this.onMoreMapClick = null;
    this.activeMenu = null;
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
    this.m.uiContainer = containerDiv;
    this.loadFoldState();
    this.loadHiddenIds();
    this.loadNamesState();
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

    // Refresh counts synchronously now. Counts are cheap to compute (the
    // provider is invoked on demand; a missing Canvas just returns null),
    // and the user should not see an empty count column while we wait.
    // Heatmap in particular publishes its final count during initScan, so the
    // column may update a second time — that is driven by the event bus.
    this.refreshAllCounts();

    // initTypesAndVisibility needs a short delay so that Heatmap/Measure and
    // other components finish their own attach/onAdd before we finalize type
    // icons and checkbox visibility. Counts are refreshed synchronously
    // above so the user sees them immediately; Heatmap publishes its final
    // count during initScan, which re-runs the refresh via the event bus.
    setTimeout(() => this.initTypesAndVisibility(), CONST.INIT_DELAY_MS);
  }

  /** Load fold state from localStorage. */
  loadFoldState() {
    this.foldedGroups = this.m.persistence.loadFoldedGroups();
  }

  /** Save fold state to localStorage. */
  saveFoldState() {
    this.m.persistence.saveFoldedGroups(this.foldedGroups);
  }

  /** Load hidden-layer ids from localStorage. */
  loadHiddenIds() {
    this.hiddenIds = this.m.persistence.loadHiddenIds();
  }

  /** Save hidden-layer ids to localStorage, coalescing rapid calls. */
  saveHiddenIds() {
    this.m.persistence.saveHiddenIds(() => this.hiddenIds);
  }

  /** Load user-assigned display names from localStorage. */
  loadNamesState() {
    this.renamedNames = this.m.persistence.loadNames();
  }

  /**
   * Propagate the user's stored state — hidden visibility and renames —
   * into the registry and the rendered rows.
   *
   * `hiddenIds` and `renamedNames` are the source of truth; the registry's
   * `LayerInfo.visible` / `LayerInfo.name` and the row checkboxes / labels
   * are their projections, refreshed here whenever a row or the registry is
   * rebuilt from a third-party layer's own metadata. Hidden is a same-axis
   * overwrite of `visible`, so it writes straight through; name is a
   * cross-axis projection that must preserve the author's original name, so
   * it goes through `applyNameProjection`, which writes only where the
   * projection still differs — a repeated pass is therefore a no-op.
   *
   * The sweep also prunes ids whose layers no longer exist so stale
   * persistence doesn't accumulate.
   *
   * @param {string} [id] Restrict to one layer id — a late-arriving row is
   *   already rendered with the right label, so it only needs its registry
   *   projection; a full sweep would re-rewrite every renamed row for no
   *   gain. Both projections are membership-guarded on this path: the drain
   *   runs for every late registration, so an unhidden layer must not be
   *   hidden and a missing rename must not write undefined.
   */
  applyUserState(id?: string) {
    const registry = this.m.layerRegistry;
    const container = this.uiContainer;

    if (id) {
      const layerInfo = registry.get(id);
      if (!layerInfo) return; // stale id — pruned by persistence on save
      // Both projections are membership-guarded — this path runs for every
      // late registration, including layers the user never touched. A layer
      // that was never hidden must not be hidden, and a missing rename is a
      // no-op rather than a write of undefined over the registry's own name.
      if (this.hiddenIds.has(id)) this.applyHiddenStateOne(layerInfo);
      if (id in this.renamedNames)
        applyNameProjection(layerInfo, null, this.renamedNames[id]);
      return;
    }

    const ids = new Set([...this.hiddenIds, ...Object.keys(this.renamedNames)]);
    for (const layerId of ids) {
      if (layerId in this.renamedNames) {
        if (layerId === CONST.COLOR.MAP_ID) {
          // The color basemap has no registry entry — only its row label.
          applyNameProjection(
            null,
            container?.querySelector(
              `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
            ) as HTMLElement | null,
            this.renamedNames[layerId],
          );
          continue;
        }
        const layerInfo = registry.get(layerId);
        if (!layerInfo) continue; // stale id — pruned by persistence on save
        applyNameProjection(
          layerInfo,
          container?.querySelector(
            `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
          ) as HTMLElement | null,
          this.renamedNames[layerId],
        );
      }
      if (this.hiddenIds.has(layerId)) {
        const layerInfo = registry.get(layerId);
        if (layerInfo) this.applyHiddenOne(layerInfo, layerId);
      }
    }

    // Prune ids whose layers no longer exist, keeping persistence tidy.
    // Hidden ids are pruned here because applyHiddenOne needs a registry entry
    // to write the projection into. Renames are pruned in unregisterLayer
    // instead — a rename whose id is not in the registry yet belongs to a
    // component that will register later, so sweeping it here would drop it
    // on the very first attach and the user would see the default name.
    const staleIds = [...this.hiddenIds].filter(
      layerId => registry.get(layerId) == null,
    );
    if (staleIds.length > 0) {
      log.warn(
        `dropped stale hidden-layer ids no longer in the registry: ${staleIds.join(", ")}`,
      );
      this.hiddenIds = new Set(
        [...this.hiddenIds].filter(layerId => registry.get(layerId) != null),
      );
      // Persist the cleaned set so the same stale ids don't get re-warned
      // on the next reload.
      this.saveHiddenIds();
    }
  }

  /**
   * Apply one hidden id: remove the layer from the map, fire the toggle
   * callback (so callback-only canvas/heatmap layers hide themselves), and
   * sync the row's checkbox and tooltip.
   */
  private applyHiddenOne(layerInfo: LayerInfo, id: string) {
    const container = this.uiContainer;
    const item = container
      ? container.querySelector(`[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`)
      : null;
    const checkbox = item?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;

    this.applyHiddenStateOne(layerInfo);

    if (checkbox) {
      checkbox.checked = false;
      checkbox.title = T("select_tooltip");
    }
    item?.classList.remove(CONST.CLASSES.ACTIVE);
  }

  /**
   * Hide one layer without touching its row — the map removal, the callback
   * for canvas-only layers, and the registry's `visible` flag.
   *
   * Split from {@link LayerUI.applyHiddenOne} because the registry projection
   * must run before the row is rendered: a late registration gets its
   * projection via {@link LayerUI.applyUserState}(id) before its row lands in
   * the DOM, so a callback-only layer hidden that way would otherwise stay
   * "visible" until the next full sweep and re-enter the map.
   */
  private applyHiddenStateOne(layerInfo: LayerInfo) {
    const layer = this.m.findLayer(layerInfo);

    // Callback-only layers (canvas) have no Leaflet layer to remove — fire
    // the toggle callback so the canvas itself hides.
    if (!layer && layerInfo.onToggle) layerInfo.onToggle(false);
    else if (layer && this.m.map.hasLayer(layer)) this.m.map.removeLayer(layer);

    layerInfo.visible = false;
  }

  /** Save user-assigned names, coalescing rapid calls. */
  saveNamesState() {
    this.m.persistence.saveNames(() => this.renamedNames);
  }

  /** Full re-scan of every row (used on attach/fold-toggle). */
  initTypesAndVisibility() {
    // Apply persisted hidden state first so initLayerItem reads the corrected
    // map state: folium adds every layer before the control IIFE runs, so on
    // reload hidden layers are back on the map. Hidden ids no longer in the
    // registry are dropped (their layer was removed).
    this.applyUserState();

    let anyBaseVisible = false;
    for (let i = 0; i < this.m.layers.length; i++) {
      if (this.initLayerItem(this.m.layers[i])) anyBaseVisible = true;
    }
    // "All bases hidden" (not "any layer hidden") — hiding an overlay on a
    // base-less map must not suppress the color-layer background.
    const baseIds = [...this.m.layers].filter(li => li.isBase).map(li => li.id);
    const allBasesHidden =
      baseIds.length > 0 && baseIds.every(id => this.hiddenIds.has(id));

    // Only fall back to the color layer when there are no visible base layers
    // *and* the user never intentionally hid every base. Otherwise the
    // fallback would undo an explicit "hide all bases" choice.
    if (!anyBaseVisible && !allBasesHidden) this.showColorLayer(this.currentColor);
    this.m.enforceOrder();
    this.syncToggleAll(CONST.GROUP.OVERLAY);
    this.syncToggleAll(CONST.GROUP.BASE);
  }

  renderInitialList() {
    // Remember the cursor by identity — the item elements are rebuilt below,
    // so an element reference would dangle. Layer rows key on data-layer-id,
    // toggle-all rows on data-group (they have no layer id). The identity also
    // tracks the row through a reorder. Null means the cursor was never
    // established or Escape cleared it, and either way it should stay cleared.
    const cursorRef = this.cursorRef();
    const frag = document.createDocumentFragment();
    let hasBaseMaps = false;
    let hasOverlays = false;

    for (let i = 0; i < this.m.layers.length; i++) {
      const layerInfo = this.m.layers[i];
      if (!layerInfo.isBase && !hasOverlays) {
        hasOverlays = true;
        frag.appendChild(
          this.renderToggleAllRow(CONST.GROUP.OVERLAY, "data_layer_label"),
        );
      }
      if (layerInfo.isBase && !hasBaseMaps) {
        hasBaseMaps = true;
        frag.appendChild(this.renderToggleAllRow(CONST.GROUP.BASE, "base_map_label"));
      }
      const group = layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY;
      const item = this.renderLayerItem(layerInfo, i);
      if (this.foldedGroups.has(group)) item.classList.add(CONST.CLASSES.GROUP_FOLDED);
      frag.appendChild(item);
    }

    const colorItem = this.renderColorLayerItem();
    if (this.foldedGroups.has(CONST.GROUP.BASE))
      colorItem.classList.add(CONST.CLASSES.GROUP_FOLDED);
    frag.appendChild(colorItem);

    this.uiContainer.innerHTML = "";
    this.uiContainer.appendChild(frag);

    // Re-home the cursor on the rebuilt element and restore DOM focus. The
    // rebuild destroys the previously focused node, dropping focus to <body>;
    // the keyboard shortcuts are dispatched by a document-level listener whose
    // container guard requires focus inside the panel, so without this the
    // cursor dies the moment the list is rebuilt (e.g. after a fold click).
    this.restoreCursor(cursorRef);
  }

  /** Identity of the row the keyboard cursor points at, for re-homing after a
   *  rebuild: a layer row's id, or a toggle-all row's group. */
  private cursorRef(): string | null {
    if (this.activeIdx === null) return null;
    const el = this.getNavigableItems()[this.activeIdx];
    return el
      ? (el.getAttribute(CONST.DATA.LAYER_ID) ?? el.getAttribute("data-group"))
      : null;
  }

  /** Re-attach the cursor (marker + DOM focus) to the rebuilt row. A row hidden
   *  by folding is not focusable, so the cursor falls back to that group's
   *  toggle-all row. If the row is gone entirely, the cursor is cleared. */
  private restoreCursor(ref: string | null): void {
    if (ref === null) {
      this.activeIdx = null;
      return;
    }
    const items = this.getNavigableItems();
    let idx = items.findIndex(
      el =>
        el.getAttribute(CONST.DATA.LAYER_ID) === ref ||
        el.getAttribute("data-group") === ref,
    );
    if (idx !== -1 && items[idx].classList.contains(CONST.CLASSES.GROUP_FOLDED)) {
      const group = items[idx].getAttribute("data-layer-type");
      idx = items.findIndex(
        el =>
          el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
          el.getAttribute("data-group") === group,
      );
    }
    if (idx !== -1) this.setActiveItem(idx);
    else this.clearActiveItem();
  }

  insertLayerItem(
    layerInfo: LayerInfo,
    { reindex = true }: { reindex?: boolean } = {},
  ) {
    const idx = this.m.layerRegistry.indexOf(layerInfo);
    if (idx === -1) return;
    const container = this.uiContainer;
    const group = layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY;

    const anchorSel =
      group === CONST.GROUP.BASE
        ? `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.BASE}"]`
        : `${CONST.SEL.LAYER_ITEM}:not([data-layer-type="${CONST.GROUP.BASE}"]):not(${CONST.SEL.COLOR_ITEM})`;
    const firstOfGroup = container.querySelector(anchorSel);

    const frag = document.createDocumentFragment();
    if (!firstOfGroup) {
      frag.appendChild(
        this.renderToggleAllRow(
          group,
          group === CONST.GROUP.BASE ? "base_map_label" : "data_layer_label",
        ),
      );
    }
    const item = this.renderLayerItem(layerInfo, idx);
    if (this.foldedGroups.has(group)) item.classList.add(CONST.CLASSES.GROUP_FOLDED);
    frag.appendChild(item);

    if (!firstOfGroup) {
      const nextGroupSel =
        group === CONST.GROUP.BASE
          ? CONST.SEL.COLOR_ITEM
          : `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.BASE}"]`;
      const nextAnchor = container.querySelector(nextGroupSel);
      if (nextAnchor) container.insertBefore(frag, nextAnchor);
      else container.appendChild(frag);
    } else container.insertBefore(frag, firstOfGroup);

    if (reindex) this.reindexItems();
    // insertLayerItem is where a late-registered (third-party) layer first
    // shows up, so the user's name and visibility land with the row instead
    // of waiting for a later pass. Only this layer's id is applied — a full
    // sweep would re-rewrite every renamed row on each registration.
    this.applyUserState(layerInfo.id);
  }

  updateLayerItem(layerInfo: LayerInfo, idx: number) {
    const item = this.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerInfo.id)}"]`,
    ) as HTMLElement | null;
    if (!item) return;
    item.dataset.index = String(idx);
    // updateItemLabel sets both the row label and the checkbox's aria-label,
    // so the name reaches assistive tech here without touching `title` — the
    // row's tooltip slot keeps the feature count + type.
    updateItemLabel(item, this.displayName(layerInfo.id));
    const checkbox = item.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    if (checkbox) checkbox.dataset.index = String(idx);
  }

  /**
   * Effective panel display name for a layer: the user-assigned rename wins,
   * falling back to the registry name, then to the locale label for the
   * virtual color basemap — the only row with no registry entry.
   *
   * Every render path resolves names through here so a registry mutation
   * (re-registration, type refresh) can no longer resurrect the original
   * third-party name over a rename.
   */
  displayName(id: string): string {
    return (
      this.renamedNames[id] ??
      this.m.layerRegistry.get(id)?.name ??
      (id === CONST.COLOR.MAP_ID ? T("color_map_label") : "")
    );
  }

  renderToggleAllRow(group: string, labelKey: string) {
    const isFolded = this.foldedGroups.has(group);
    return dom.el(
      "div",
      {
        class:
          `${CONST.CLASSES.FOLD_BTN_CTR} ${CONST.CLASSES.TOGGLE_ALL}` +
          (isFolded ? ` ${CONST.CLASSES.FOLDED}` : ""),
        tabindex: "0",
        "data-group": group,
        title: T(isFolded ? "unfold_tooltip" : "fold_tooltip"),
      },
      dom.el(
        "button",
        {
          class: CONST.CLASSES.FOLD_BTN,
        },
        { html: SVGs.FOLD },
      ),
      dom.el(
        "div",
        { class: CONST.CLASSES.CHECKBOX },
        dom.el("input", {
          type: "checkbox",
          "data-role": "toggle-all",
          checked: "",
          title: T("toggle_all_deselect_tooltip"),
        }),
      ),
      dom.el("span", { class: CONST.CLASSES.SEP_LABEL }, T(labelKey)),
      dom.el("div", { class: "foliplus-section-divider" }),
    );
  }

  /** Render a single layer row.
   *  Structure: [drag-handle][checkbox][label (flex)] [count][type-icon-col].
   *  The count column is inserted immediately before the type-icon column so
   *  the two right-side decorations stay visually grouped.  The count value
   *  is populated lazily by initLayerItem (layer may not be resolved yet at
   *  render time) and refreshed by onLayerItemCountChange.
   *  @param {Object} layerInfo - Layer metadata.
   *  @param {number} idx - Position in the ordered registry.
   *  @returns {HTMLElement} The row element. */
  renderLayerItem(layerInfo: LayerInfo, idx: number) {
    const name = this.displayName(layerInfo.id);

    const typeIconEl = dom.el("div", { class: CONST.CLASSES.TYPE_ICON_COL });
    if (layerInfo.iconSvg) typeIconEl.innerHTML = layerInfo.iconSvg;

    const moreBtn = dom.el(
      "button",
      {
        class: CONST.CLASSES.MORE_BTN,
        type: "button",
        title: T("more_tooltip"),
        "aria-label": T("more_tooltip"),
      },
      { html: SVGs.MORE },
    );
    // All layers get the "more" button — data layers can focus + rename, base
    // maps can rename (focus on a base map is a harmless full-world fitBounds).

    const children: HTMLElement[] = [
      dom.el(
        "span",
        { class: CONST.CLASSES.DRAG_CELL, title: T("drag_tooltip") },
        { html: SVGs.DRAG_HANDLE },
      ),
      dom.el(
        "div",
        { class: CONST.CLASSES.CHECKBOX },
        dom.el("input", {
          type: "checkbox",
          checked: "",
          [CONST.DATA.INDEX]: String(idx),
          // The name reaches assistive tech via aria-label. `title` is the
          // Select/Deselect slot — initLayerItem sets it per checked state
          // before this row can be hovered, so leave it unseeded rather than
          // flashing the layer name.
          "aria-label": name,
        }),
      ),
      dom.el("label", { class: CONST.CLASSES.LAYER_LABEL }, name),
      dom.el("span", {
        class: CONST.CLASSES.COUNT_COL,
        [CONST.DATA.LAYER_ID]: layerInfo.id,
      }),
      typeIconEl,
      moreBtn,
    ];

    return dom.el(
      "div",
      {
        class: CONST.CLASSES.LAYER_ITEM,
        draggable: "true",
        tabindex: "0",
        [CONST.DATA.INDEX]: String(idx),
        [CONST.DATA.LAYER_ID]: layerInfo.id,
        "data-layer-type": layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY,
      },
      ...children,
    );
  }

  /** Current display name for the virtual color basemap: persisted rename if
   *  present, else the locale label. The color layer has no registry entry. */
  private colorLayerName(): string {
    return this.displayName(CONST.COLOR.MAP_ID);
  }

  renderColorLayerItem() {
    // The input announces the same name as the row's label cell below, so a
    // rename reaches assistive tech on both — not just the visible text.
    const colorName = this.colorLayerName();
    const colorInput = dom.el("input", {
      type: "color",
      class: CONST.CLASSES.COLOR_INPUT,
      value: this.currentColor,
      "aria-label": colorName,
    });

    // Color layer lives outside layerRegistry — rename is the only overflow
    // action (no focus on a basemap without bounds).
    const moreBtn = dom.el(
      "button",
      {
        class: CONST.CLASSES.MORE_BTN,
        type: "button",
        title: T("more_tooltip"),
        "aria-label": T("more_tooltip"),
      },
      { html: SVGs.MORE },
    );

    // The color basemap's hover tooltip is its TYPE label (like every other
    // row, which shows "count · type"); the layer name lives in the label
    // cell, not the tooltip. Persist the type label in data-item-title so a
    // rebuild can restore it; this must be the constant T("type_color_map"),
    // NOT colorLayerName() — a rename must not change the tooltip.
    const colorType = T("type_color_map");
    return dom.el(
      "div",
      {
        class: `${CONST.CLASSES.LAYER_ITEM} ${CONST.CLASSES.COLOR_ITEM}`,
        draggable: "false",
        [CONST.DATA.LAYER_ID]: CONST.COLOR.MAP_ID,
        [CONST.DATA.TITLE]: colorType,
        title: colorType,
      },
      dom.el("span", { class: CONST.CLASSES.DRAG_CELL }, { html: SVGs.DRAG_HANDLE }),
      dom.el("div", { class: CONST.CLASSES.CHECKBOX }, colorInput),
      dom.el("label", { class: CONST.CLASSES.LAYER_LABEL }, this.colorLayerName()),
      // count column is empty (color layers have no feature count).
      dom.el("span", { class: CONST.CLASSES.COUNT_COL }),
      dom.el("div", { class: CONST.CLASSES.TYPE_ICON_COL, innerHTML: SVGs.COLOR }),
      moreBtn,
    );
  }

  /** Initialize one layer row's checkbox + type icon (incremental path).
   *  @returns {boolean} true when the row is a visible base layer. */
  initLayerItem(layerInfo: LayerInfo): boolean {
    const idx = this.m.layerRegistry.indexOf(layerInfo);
    if (idx === -1) return false;
    const name = this.displayName(layerInfo.id);
    const inputs = this.uiContainer.querySelectorAll(
      `${CONST.SEL.LAYER_ITEM} input[type="checkbox"], ${CONST.SEL.LAYER_ITEM} input[type="radio"]`,
    ) as NodeListOf<HTMLInputElement>;
    const typeCols = this.uiContainer.querySelectorAll(
      `.${CONST.CLASSES.TYPE_ICON_COL}`,
    );
    const input = inputs[idx];
    const typeCol = typeCols[idx];
    const layer = this.m.findLayer(layerInfo);
    let baseVisible = false;

    if (input) {
      const hasLayer = layer != null;
      const isCallbackOnly = !hasLayer && layerInfo.onToggle;
      if (isCallbackOnly) input.checked = layerInfo.visible !== false;
      else input.checked = hasLayer && this.m.map.hasLayer(layer);
      this.syncVisibility(layerInfo, layer, input.checked);

      input.title = T(input.checked ? "deselect_tooltip" : "select_tooltip");

      const item = input.closest(CONST.SEL.LAYER_ITEM);
      if (item) {
        if (input.checked) item.classList.add(CONST.CLASSES.ACTIVE);
        else item.classList.remove(CONST.CLASSES.ACTIVE);
        // The rename must survive a full init pass — initLayerItem is the
        // only incremental path that refreshes a row without re-rendering it.
        // aria-label carries the name; the title slot stays Select/Deselect
        // as set above.
        input.setAttribute("aria-label", name);
      }
    }

    if (typeCol) {
      let typeKey: string;
      let type: string | null = null;
      if (layerInfo.isBase) {
        typeCol.innerHTML = Icons.GLOBE;
        typeKey = T("type_base");
        type = CONST.GROUP.BASE;
        layerInfo.type = type;
        if (input?.checked) baseVisible = true;
      } else if (layerInfo.iconSvg) {
        typeCol.innerHTML = layerInfo.iconSvg;
        typeKey = T("type_custom");
        type = GEOM_TYPE.CUSTOM;
        layerInfo.type = type;
      } else if (layer) {
        const gtype = getGeometryType(layer);
        typeCol.innerHTML = Util.getTypeSVG(layer, gtype);
        typeKey = T(`type_${gtype}`);
        type = gtype;
        layerInfo.type = type;
      } else {
        typeKey = T("type_unknown");
        type = GEOM_TYPE.UNKNOWN;
        layerInfo.type = type;
      }

      const item = input
        ? (input.closest(CONST.SEL.LAYER_ITEM) as HTMLElement | undefined)
        : (typeCol.closest(CONST.SEL.LAYER_ITEM) as HTMLElement | undefined);
      if (item) {
        const count = this.mgmt.getFeatureCount(layerInfo.id);
        // Update count column (right-aligned, adjacent to type icon).
        const countCol = item.querySelector(CONST.SEL.COUNT_COL) as HTMLElement | null;
        if (countCol) {
          if (count !== null && count !== undefined)
            countCol.textContent = formatNumber(count, "auto", CONF.locale_code);
          else countCol.textContent = "";
        }
        // Hover tooltip shows count + type label together.
        const typeLabel = typeKey;
        // Persist the type label so onLayerItemCountChange can rebuild the
        // 'count + type' tooltip without re-running type detection.
        item.setAttribute(CONST.DATA.TITLE, typeLabel);
        item.title =
          count !== null && count !== undefined
            ? `${formatNumber(count, "auto", CONF.locale_code)} ${typeLabel}`
            : typeLabel;
      }
    }

    return baseVisible;
  }

  reindexItems() {
    const items = this.uiContainer.querySelectorAll(
      `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.COLOR_ITEM})`,
    ) as NodeListOf<HTMLElement>;
    for (let i = 0; i < items.length; i++) {
      items[i].dataset.index = String(i);
      const checkbox = items[i].querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement | null;
      if (checkbox) checkbox.dataset.index = String(i);
    }
  }

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
      // Record the row the pointer touched. Clicking the label or the checkbox
      // does not move DOM focus off the previously focused row, so the marker
      // has to be re-homed here or the next Space/Enter toggles the wrong row.
      this.clickedRow =
        el.closest(CONST.SEL.LAYER_ITEM) ?? el.closest(CONST.SEL.TOGGLE_ALL);
      this.syncActiveItem();

      if (el.closest(CONST.SEL.COLOR_ITEM)) {
        this.deselectAllBaseMaps(-1);
        this.showColorLayer(this.currentColor);
        this.syncToggleAll(CONST.GROUP.BASE);
        this.m.enforceOrder();
        return;
      }
      const row = el.closest(CONST.SEL.TOGGLE_ALL) as HTMLElement | null;
      if (!row || el.closest('[data-role="toggle-all"]')) return;
      const group = row.dataset.group ?? "";
      if (this.foldedGroups.has(group)) this.foldedGroups.delete(group);
      else this.foldedGroups.add(group);
      this.renderInitialList();
      this.initTypesAndVisibility();
      this.refreshAllCounts();
      this.saveFoldState();
    };

    this.onDragStart = event => this.handleDragStart(event);
    this.onDragOver = event => this.handleDragOver(event);
    this.onDragLeave = event => this.handleDragLeave(event);
    this.onDrop = event => this.handleDrop(event);
    this.onDragEnd = () => this.handleDragEnd();
    this.onKeyDown = event => this.handleKeyDown(event);
    // A real focus move supersedes the pointer: once focus lands elsewhere, the
    // last-clicked row is stale and must not outrank it. Synthetic clicks and
    // clicks on the non-focusable label don't fire focusin, so clickedRow still
    // survives the cases that need it.
    this.onFocusIn = () => {
      this.clickedRow = null;
    };
    this.interactionCleanup = registerInteractions(this);

    container.addEventListener("change", this.onChange);
    container.addEventListener("input", this.onInput);
    container.addEventListener("click", this.onClick);
    container.addEventListener("focusin", this.onFocusIn);
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
      if (countCol && count !== null && count !== undefined)
        countCol.textContent = formatNumber(count, "auto", CONF.locale_code);
      else if (countCol) countCol.textContent = "";
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
    if (this.onDragStart) container.removeEventListener("dragstart", this.onDragStart);
    if (this.onDragOver) container.removeEventListener("dragover", this.onDragOver);
    if (this.onDragLeave) container.removeEventListener("dragleave", this.onDragLeave);
    if (this.onDrop) container.removeEventListener("drop", this.onDrop);
    if (this.onDragEnd) container.removeEventListener("dragend", this.onDragEnd);
    if (this.onMoreClick) container.removeEventListener("click", this.onMoreClick);
    if (this.onMoreMenuClick)
      document.removeEventListener("click", this.onMoreMenuClick);
    if (this.onMoreMapClick) this.m.map.off("click", this.onMoreMapClick);
    this.clearActiveItem();
    this.interactionCleanup?.();
    this.m.persistence.cancelSaveHiddenIds();
    this.onChange = this.onInput = this.onClick = null;
    this.onFocusIn = null;
    this.onDragStart = this.onDragOver = this.onDragLeave = null;
    this.onDrop = this.onDragEnd = null;
    this.onMoreClick = this.onMoreMenuClick = null;
    this.onMoreMapClick = null;
    this.onKeyDown = null;
    if (this.unsubscribeCountChange) {
      this.unsubscribeCountChange();
      this.unsubscribeCountChange = null;
    }
  }

  getLayerItems(group: string): NodeListOf<Element> {
    return this.uiContainer.querySelectorAll(
      `${CONST.SEL.LAYER_ITEM}${group === CONST.GROUP.BASE ? `[data-layer-type="${CONST.GROUP.BASE}"]` : `:not([data-layer-type="${CONST.GROUP.BASE}"]):not(${CONST.SEL.COLOR_ITEM})`}`,
    );
  }

  toggleAll(group: string, newState: boolean) {
    const items = this.getLayerItems(group);
    items.forEach((item: Element) => {
      const checkbox = item.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement | null;
      if (!checkbox) return;
      const idx = parseInt(checkbox.dataset.index ?? "", 10);
      if (isNaN(idx) || idx < 0 || idx >= this.m.layers.length) return;
      const layerInfo = this.m.layers[idx];
      const layer = this.m.findLayer(layerInfo);

      checkbox.checked = newState;
      checkbox.title = T(newState ? "deselect_tooltip" : "select_tooltip");
      if (newState) item.classList.add(CONST.CLASSES.ACTIVE);
      else item.classList.remove(CONST.CLASSES.ACTIVE);

      if (layer) newState ? this.m.map.addLayer(layer) : this.m.map.removeLayer(layer);
      if (newState && layer) layer.options.paneSet = false;
      if (layerInfo.onToggle) layerInfo.onToggle(newState);
      this.syncVisibility(layerInfo, layer, newState);
      // No persist per iteration — schedule a single debounced write after the
      // loop so the debounce timer isn't reset for every layer.
      this.syncHiddenId(layerInfo.id, !newState, false);
    });

    // Persist hidden-set after bulk toggle (single debounced write for the batch).
    this.saveHiddenIds();

    if (group === CONST.GROUP.BASE && !newState) {
      this.hideColorLayer();
      this.showColorLayer(this.currentColor);
    } else if (group === CONST.GROUP.BASE && newState) this.hideColorLayer();

    this.syncToggleAll(group);
    this.m.debouncedEnforce();
  }

  syncToggleAll(group: string) {
    const row = this.uiContainer.querySelector(
      `${CONST.SEL.TOGGLE_ALL}[data-group="${group}"]`,
    );
    if (!row) return;
    const allCb = row.querySelector(
      '[data-role="toggle-all"]',
    ) as HTMLInputElement | null;
    if (!allCb) return;
    const items = this.getLayerItems(group);
    const checkedCount = Array.from(items).filter((item: Element) => {
      const checkbox = item.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement | null;
      return checkbox && checkbox.checked;
    }).length;
    const allChecked = items.length > 0 && checkedCount === items.length;
    const noneChecked = checkedCount === 0;
    allCb.checked = allChecked;
    allCb.indeterminate = !allChecked && !noneChecked;
    allCb.title = T(
      allChecked || allCb.indeterminate
        ? "toggle_all_deselect_tooltip"
        : "toggle_all_select_tooltip",
    );
  }

  syncVisibility(layerInfo: LayerInfo, layer: L.Layer | null, fallback: boolean) {
    layerInfo.visible = layer ? this.m.map.hasLayer(layer) : fallback;
    return layerInfo.visible;
  }

  handleChange(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.classList.contains(CONST.CLASSES.COLOR_INPUT)) {
      this.deselectAllBaseMaps(-1);
      this.showColorLayer(target.value);
      this.syncToggleAll(CONST.GROUP.BASE);
      this.m.enforceOrder();
      return;
    }
    if (target.tagName.toLowerCase() !== "input" || target.type !== "checkbox") return;

    const idx = parseInt(target.dataset.index ?? "", 10);
    if (isNaN(idx) || idx < 0 || idx >= this.m.layers.length) return;
    const layerInfo = this.m.layers[idx];
    const layer = this.m.findLayer(layerInfo);
    const item = target.closest(CONST.SEL.LAYER_ITEM);

    if (layerInfo.isBase) this.hideColorLayer();
    if (layer)
      target.checked ? this.m.map.addLayer(layer) : this.m.map.removeLayer(layer);
    if (target.checked && layer) layer.options.paneSet = false;
    if (item)
      target.checked
        ? item.classList.add(CONST.CLASSES.ACTIVE)
        : item.classList.remove(CONST.CLASSES.ACTIVE);

    target.title = T(target.checked ? "deselect_tooltip" : "select_tooltip");

    if (layerInfo.onToggle) layerInfo.onToggle(target.checked);
    this.syncVisibility(layerInfo, layer, target.checked);
    this.syncHiddenId(layerInfo.id, !target.checked);

    this.syncToggleAll(layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY);
    this.m.debouncedEnforce();
  }

  handleInput(event: Event) {
    if ((event.target as HTMLElement).classList.contains(CONST.CLASSES.COLOR_INPUT))
      this.showColorLayer((event.target as HTMLInputElement).value);
  }

  /**
   * Update the persisted hidden set for a layer toggle.
   * @param {boolean} persist - When false (bulk updates like toggleAll), the
   *   caller schedules a single save after the loop instead of resetting the
   *   debounce timer for every layer.
   */
  private syncHiddenId(id: string, hidden: boolean, persist: boolean = true) {
    if (hidden) this.hiddenIds.add(id);
    else this.hiddenIds.delete(id);
    if (persist) this.saveHiddenIds();
  }

  /** Get all keyboard-navigable rows: layer items and toggle-all rows, in DOM
   *  order. The color item is excluded (it is a picker, not a layer). */
  getNavigableItems(): HTMLElement[] {
    return Array.from(
      this.uiContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    )
      .map(
        cb =>
          (cb.closest(CONST.SEL.LAYER_ITEM) ??
            cb.closest(CONST.SEL.TOGGLE_ALL)) as HTMLElement | null,
      )
      .filter(
        (el): el is HTMLElement =>
          el !== null && !el.classList.contains(CONST.CLASSES.COLOR_ITEM),
      );
  }

  /** Index of the nearest row in `step` direction that is not folded away,
   *  or -1 when the cursor would leave the list. Folded rows are display:none
   *  and not focusable, so plain index ± 1 would strand the cursor on them. */
  private findVisibleNeighbor(items: HTMLElement[], idx: number, step: 1 | -1): number {
    for (let i = idx + step; i >= 0 && i < items.length; i += step) {
      if (!items[i].classList.contains(CONST.CLASSES.GROUP_FOLDED)) return i;
    }
    return -1;
  }

  /** Get the currently focused layer item element. */
  getActiveLayerItem(): HTMLElement | null {
    if (this.activeIdx === null) return null;
    return this.getNavigableItems()[this.activeIdx] ?? null;
  }

  /** Set the active item index and apply focus styling. */
  setActiveItem(idx: number): void {
    this.clearActiveItem();
    const items = this.getNavigableItems();
    if (idx < 0 || idx >= items.length) {
      this.activeIdx = null;
      return;
    }
    const item = items[idx];
    this.moveActiveMarker(item, items);
    item.focus();
  }

  /** Move the focus marker onto an item. The marker lives on the element as
   *  well as in activeIdx, so it must travel with the cursor — otherwise the
   *  row that was clicked before keeps the marker and reads as the active row.
   *  blurActiveItem() scans the DOM rather than following activeIdx, so a
   *  marker stranded on an old, rebuilt element is picked up too. Callers pass
   *  the item list they already hold rather than re-querying for indexOf. */
  private moveActiveMarker(item: HTMLElement | null, items: HTMLElement[]): void {
    this.blurActiveItem();
    // indexOf yields -1 for an item outside the list; normalize it to null so
    // activeIdx never holds an index getActiveLayerItem() would misread.
    const idx = item ? items.indexOf(item) : -1;
    this.activeIdx = idx === -1 ? null : idx;
    item?.classList.add(CONST.CLASSES.FOCUSED);
  }

  /** Remove the focus marker from whichever item carries it.
   *  Scans the DOM instead of following activeIdx: a re-render rebuilds the
   *  item elements, leaving the marker on an old, now-detached node. */
  blurActiveItem(): void {
    this.uiContainer
      .querySelector(`.${CONST.CLASSES.FOCUSED}`)
      ?.classList.remove(CONST.CLASSES.FOCUSED);
  }

  /** Clear the active item state. */
  clearActiveItem(): void {
    this.blurActiveItem();
    this.activeIdx = null;
    this.clickedRow = null;
  }

  /** Index of the keyboard cursor, or null if none. DOM focus wins when it
   *  names a row the pointer has since left; clickedRow wins when focus is
   *  stale — a click on the label or checkbox does not move focus off the
   *  previously focused row, which is what made Space/Enter toggle the wrong
   *  row. The DOM-focus read is the bootstrap: the very first key has no
   *  clickedRow yet and establishes the cursor. */
  private resolveActiveIdx(items: HTMLElement[]): number | null {
    const rows: (HTMLElement | null)[] = [];
    if (this.clickedRow) rows.push(this.clickedRow);
    rows.push(
      document.activeElement?.closest(CONST.SEL.LAYER_ITEM) ??
        document.activeElement?.closest(CONST.SEL.TOGGLE_ALL) ??
        null,
    );
    for (const row of rows) {
      if (!row) continue;
      const idx = items.indexOf(row);
      if (idx !== -1) {
        this.activeIdx = idx;
        return idx;
      }
    }
    return null;
  }

  /** Align the cursor marker with whichever row resolveActiveIdx() names.
   *  Queries once — resolveActiveIdx and moveActiveMarker both need the list. */
  private syncActiveItem(): void {
    const items = this.getNavigableItems();
    const idx = this.resolveActiveIdx(items);
    this.moveActiveMarker(idx === null ? null : items[idx], items);
  }

  /** Reindex all layer items after a move, preserving the active focus position.
   *  renderInitialList already re-homes the cursor and restores DOM focus, so
   *  no additional focus work is needed here. */
  reindexAfterMove(): void {
    this.renderInitialList();
    this.initTypesAndVisibility();
    this.refreshAllCounts();
  }

  /**
   * Keyboard event handler for layer navigation and interaction.
   * Only responds when focus is within the layer panel.
   *
   * Supported shortcuts:
   *   ArrowUp / ArrowDown - Navigate between layer items
   *   ArrowLeft / ArrowRight / Space / Enter - Toggle visibility of focused layer
   *   Ctrl+ArrowUp / Ctrl+ArrowDown - Move focused layer up/down in z-order
   *   Escape - Clear focus
   */
  handleKeyDown(event: KeyboardEvent): void {
    if (!this.uiContainer.contains(document.activeElement)) return;

    const items = this.getNavigableItems();
    if (items.length === 0) return;

    // Re-resolve the cursor from DOM focus. Clicking the label and a re-render
    // both move focus, so a stored index could name a row the user has left.
    // This also establishes the cursor on the very first key.
    this.syncActiveItem();
    const idx = this.activeIdx;
    if (idx === null || !items[idx]) return;
    const item = items[idx];

    if (event.ctrlKey || event.metaKey) {
      const id = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const moved = this.m.moveLayerUp(id);
        if (!moved) {
          map.foliplus!.showHint(CONF.name, T("reorder_top"), HINT_DURATION.SHORT);
        }
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        const moved = this.m.moveLayerDown(id);
        if (!moved) {
          map.foliplus!.showHint(CONF.name, T("reorder_bottom"), HINT_DURATION.SHORT);
        }
      }
      const newItems = this.getNavigableItems();
      const next = newItems.findIndex(
        el => el.getAttribute(CONST.DATA.LAYER_ID) === id,
      );
      // findIndex yields -1 if the row is gone (e.g. layer removed mid-drag);
      // normalize it so activeIdx never holds an invalid index.
      this.activeIdx = next === -1 ? null : next;
      return;
    }

    // Alt+Enter: focus-layer on the currently navigated layer item. This
    // is a dedicated keyboard entry point (in addition to the ⋮ menu) so
    // power users can focus without leaving the keyboard.
    if (event.altKey && event.key === "Enter" && this.activeIdx !== null) {
      const item = items[this.activeIdx];
      if (item) {
        const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
        if (layerId) {
          event.preventDefault();
          this.focusLayer(layerId);
          return;
        }
      }
    }

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        const up = this.findVisibleNeighbor(items, idx, -1);
        if (up !== -1) this.setActiveItem(up);
        break;
      case "ArrowDown":
        event.preventDefault();
        const down = this.findVisibleNeighbor(items, idx, 1);
        if (down !== -1) this.setActiveItem(down);
        break;
      case "ArrowLeft":
      case "ArrowRight":
      case " ":
      case "Enter":
        // Do not toggle the checkbox when the more (⋮) button is focused —
        // that key opens the overflow menu instead.
        if (document.activeElement?.classList.contains(CONST.CLASSES.MORE_BTN)) {
          event.preventDefault();
          event.stopPropagation();
          const item = (document.activeElement as HTMLElement).closest(
            CONST.SEL.LAYER_ITEM,
          ) as HTMLElement | null;
          if (item) this.openMoreMenu(item);
          break;
        }
        // Menu item (li) is focused — trigger the focus-layer action.
        // Skip disabled items so the hidden-layer guard applies to keyboard too.
        const menuLi = (document.activeElement as HTMLElement | null)?.closest?.(
          ".foliplus-layer-more-menu li",
        );
        if (menuLi && this.activeMenu) {
          event.preventDefault();
          event.stopPropagation();
          const action = menuLi.getAttribute("data-action") ?? "";
          if (menuLi.getAttribute("disabled")) {
            this.m.map.foliplus!.showHint(
              CONF.name,
              T("focus_layer_hidden"),
              HINT_DURATION.SHORT,
            );
            break;
          }
          if (action === CONST.ACTION.RENAME_LAYER)
            this.renameLayer(this.activeMenu.layerId);
          else {
            this.focusLayer(this.activeMenu.layerId);
            this.closeMoreMenu(true);
          }
          break;
        }
        event.preventDefault();
        this.toggleFocusedLayer();
        break;
      case "Escape":
        if (this.activeMenu) this.closeMoreMenu(true);
        else this.clearActiveItem();
        break;
    }
  }

  /** Double-click on a layer row → focus the map on that layer. */
  handleDblClick(event: MouseEvent): void {
    const item = (event.target as HTMLElement).closest(
      CONST.SEL.LAYER_ITEM,
    ) as HTMLElement | null;
    if (!item) return;
    // Ignore dblclick on the ⋮ button (would open the menu instead).
    if ((event.target as HTMLElement).closest(`.${CONST.CLASSES.MORE_BTN}`)) {
      return;
    }
    const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
    if (!layerId) return;
    this.focusLayer(layerId);
  }

  /** Toggle visibility of the currently focused layer. */
  private toggleFocusedLayer(): void {
    const item = this.getActiveLayerItem();
    if (!item) return;
    const checkbox = item.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  }

  handleDragStart(event: DragEvent) {
    const item = (event.target as HTMLElement).closest(
      CONST.SEL.LAYER_ITEM,
    ) as HTMLElement | null;
    if (!item) return;
    this.dragIdx = parseInt(item.dataset.index ?? "", 10);
    item.classList.add(CONST.CLASSES.DRAGGING);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  showReorderBlockedHint() {
    const now = Date.now();
    if (now - this.lastDragHintAt < CONST.DRAG.HINT_COOLDOWN_MS) return;
    this.lastDragHintAt = now;
    map.foliplus!.showHint(CONF.name, T("reorder_group_only"), HINT_DURATION.SHORT);
  }

  handleDragOver(event: DragEvent) {
    if (this.dragIdx === null) return;
    event.preventDefault();
    const item = (event.target as HTMLElement).closest(
      CONST.SEL.LAYER_ITEM,
    ) as HTMLElement | null;
    if (!item || item.classList.contains(CONST.CLASSES.COLOR_ITEM)) return;

    const targetIdx = parseInt(item.dataset.index ?? "", 10);
    const prev = this.lastDragOverItem;
    if (prev && prev !== item)
      prev.classList.remove(
        CONST.CLASSES.DRAG_OVER_TOP,
        CONST.CLASSES.DRAG_OVER_BOTTOM,
      );
    item.classList.remove(CONST.CLASSES.DRAG_OVER_TOP, CONST.CLASSES.DRAG_OVER_BOTTOM);
    this.lastDragOverItem = item;

    if (!this.m.canReorderBetween(this.dragIdx, targetIdx)) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      this.showReorderBlockedHint();
      return;
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

    if (targetIdx < this.dragIdx) item.classList.add(CONST.CLASSES.DRAG_OVER_TOP);
    else if (targetIdx > this.dragIdx)
      item.classList.add(CONST.CLASSES.DRAG_OVER_BOTTOM);
  }

  handleDragLeave(event: DragEvent) {
    const item = (event.target as HTMLElement).closest(
      CONST.SEL.LAYER_ITEM,
    ) as HTMLElement | null;
    if (item)
      item.classList.remove(
        CONST.CLASSES.DRAG_OVER_TOP,
        CONST.CLASSES.DRAG_OVER_BOTTOM,
      );
  }

  handleDrop(event: DragEvent) {
    event.preventDefault();
    const target = (event.target as HTMLElement).closest(
      CONST.SEL.LAYER_ITEM,
    ) as HTMLElement | null;
    if (this.dragIdx === null) return;
    if (!target || target.classList.contains(CONST.CLASSES.COLOR_ITEM)) return;

    if (this.dragIdx < 0 || this.dragIdx >= this.m.layers.length) {
      this.dragIdx = null;
      return;
    }

    const targetIdx = parseInt(target.dataset.index ?? "", 10);
    if (this.dragIdx === targetIdx) return;
    if (!this.m.canReorderBetween(this.dragIdx, targetIdx)) {
      this.showReorderBlockedHint();
      return;
    }

    this.m.layerRegistry.reorder(this.dragIdx, targetIdx);
    const moved = this.m.layers[targetIdx];

    const movedItem = this.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="${CSS.escape(moved.id)}"]`,
    );
    if (!movedItem) {
      this.dragIdx = null;
      return;
    }

    if (targetIdx < this.dragIdx) {
      if (target.parentNode) target.parentNode.insertBefore(movedItem, target);
    } else if (target.parentNode) {
      target.parentNode.insertBefore(movedItem, target.nextSibling);
    }

    this.reindexItems();
    this.m.enforceOrder();
    this.m.saveOrder();
    this.dragIdx = null;
  }

  handleDragEnd() {
    this.dragIdx = null;
    this.lastDragOverItem = null;
    const allItems = this.uiContainer.querySelectorAll(CONST.SEL.LAYER_ITEM);
    allItems.forEach((i: Element) =>
      i.classList.remove(
        CONST.CLASSES.DRAGGING,
        CONST.CLASSES.DRAG_OVER_TOP,
        CONST.CLASSES.DRAG_OVER_BOTTOM,
      ),
    );
  }

  showColorLayer(color: string) {
    this.isColorActive = true;
    this.currentColor = color;
    mapContainer.style.setProperty("--color-layer-bg", color);
    mapContainer.classList.add(CONST.CLASSES.ACTIVE);

    for (let i = 0; i < this.m.layers.length; i++) {
      if (this.m.layers[i].isBase) {
        const bLayer = this.m.findLayer(this.m.layers[i]);
        if (bLayer && this.m.map.hasLayer(bLayer)) this.m.map.removeLayer(bLayer);
      }
    }

    const tilePane = this.m.map.getPane("tilePane");
    if (tilePane) tilePane.classList.add("foliplus-layer-tile-hidden");

    const inputs = this.uiContainer.querySelectorAll(
      `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.COLOR_ITEM}) input`,
    ) as NodeListOf<HTMLInputElement>;
    inputs.forEach((input: HTMLInputElement, j: number) => {
      if (this.m.layers[j]?.isBase) {
        input.checked = false;
        input.closest(CONST.SEL.LAYER_ITEM)?.classList.remove(CONST.CLASSES.ACTIVE);
      }
    });

    const ci = this.uiContainer.querySelector(
      CONST.SEL.COLOR_INPUT,
    ) as HTMLInputElement | null;
    if (ci) ci.value = color;
    this.uiContainer
      .querySelector(CONST.SEL.COLOR_ITEM)
      ?.classList.add(CONST.CLASSES.ACTIVE);
    this.syncToggleAll(CONST.GROUP.BASE);
  }

  hideColorLayer() {
    this.isColorActive = false;
    mapContainer.classList.remove(CONST.CLASSES.ACTIVE);
    mapContainer.style.removeProperty("--color-layer-bg");
    const tilePane = this.m.map.getPane("tilePane");
    if (tilePane) tilePane.classList.remove("foliplus-layer-tile-hidden");
    this.uiContainer
      .querySelector(CONST.SEL.COLOR_ITEM)
      ?.classList.remove(CONST.CLASSES.ACTIVE);
  }

  /**
   * Open the "more" overflow dropdown for a given layer row.
   * Every layer (data + base) has this button; it exposes focus + rename.
   */
  openMoreMenu(item: HTMLElement) {
    // Close any previously open menu first, and commit/cancel a rename so
    // the label text is fresh before we read the row.
    this.finishRename();
    this.closeMoreMenu(true);

    const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
    const menu = dom.el("ul", { class: "foliplus-layer-more-menu open", role: "menu" });
    // Color basemap has no bounds — focus is not meaningful, so skip the
    // focus-layer menu item. Rename is still available (persistence only).
    const skipFocus = item.classList.contains(CONST.CLASSES.COLOR_ITEM);

    if (!skipFocus) {
      const isHidden =
        (item.querySelector('input[type="checkbox"]') as HTMLInputElement | null)
          ?.checked === false;

      const itemAttrs = {
        "data-action": "focus-layer",
        role: "menuitem",
        tabindex: "0",
        title: isHidden ? T("focus_layer_hidden") : T("focus_layer_tooltip"),
        "aria-disabled": isHidden ? "true" : "false",
      };

      menu.appendChild(dom.el("li", itemAttrs, { html: SVGs.FOCUS }, T("focus_layer")));

      if (isHidden) menu.lastElementChild!.setAttribute("disabled", "disabled");
    }

    menu.appendChild(
      dom.el(
        "li",
        {
          "data-action": CONST.ACTION.RENAME_LAYER,
          role: "menuitem",
          tabindex: "0",
          title: T("rename_layer_tooltip"),
        },
        { html: Icons.EDIT },
        T("rename_layer"),
      ),
    );

    item.style.position = "relative";
    item.appendChild(menu);

    this.activeMenu = { item, menu, layerId };

    // Focus the first menu item so Enter/Space activate it and Escape closes.
    const firstItem = menu.querySelector(".foliplus-layer-more-menu li") as HTMLElement;
    if (firstItem) firstItem.focus();
  }

  /** Close the overflow menu. setFocus = true returns focus to the layer row. */
  closeMoreMenu(setFocus: boolean) {
    if (!this.activeMenu) return;
    const item = this.activeMenu.item;
    this.activeMenu.menu.remove();
    this.activeMenu = null;
    if (setFocus) item.focus();
  }

  /**
   * Turn the layer's label into an inline editable input so the user can
   * rename it. Enter/blur commits (non-empty), Escape cancels.
   *
   * The input replaces only the label's text node (the `<label>` element
   * stays in place), so layout / keyboard cursor focus is preserved. A
   * trailing space in the committed name would otherwise render as a zero-width
   * gap, so the value is trimmed on commit.
   */
  renameLayer(layerId: string): void {
    if (!layerId || !this.uiContainer) return;
    this.finishRename();

    const layerInfo = this.m.layerRegistry.get(layerId);
    const isColorLayer = layerId === CONST.COLOR.MAP_ID;
    if (!layerInfo && !isColorLayer) return;

    const item = this.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
    ) as HTMLElement | null;
    const label = item?.querySelector("label") as HTMLLabelElement | null;
    if (!label) return;

    // displayName resolves rename → registry → the color layer's locale label,
    // so the input opens with the name the UI already shows.
    const currentName = this.displayName(layerId);

    this.activeRenameId = layerId;
    // Flag the row so CSS can stretch the input across the label+count area
    // (matching the SearchControl field's full extent) while editing.
    item?.classList.add(CONST.CLASSES.RENAMING);
    createInlineEditInput({
      label,
      initialValue: currentName,
      className: `${CONST.CLASSES.RENAME_INPUT} foliplus-input`,
      ariaLabel: T("rename_hint"),
      // Only commit on blur while this is still the active rename. Enter/Escape
      // call finishRename() which sets activeRenameId=null and removes the
      // focused input → that removal fires a blur that must not re-commit.
      isActive: () => this.activeRenameId === layerId,
      onCommit: trimmed => {
        const changed = trimmed !== currentName;
        if (changed) {
          // renamedNames is the source of truth; the registry entry and the
          // row labels are projections that applyUserState() pushes out, so
          // a re-registration that rebuilds the registry from a third-party
          // layer's own metadata cannot resurrect the author's original name.
          this.renamedNames[layerId] = trimmed;
          this.saveNamesState();
          this.applyUserState();
        }
        this.finishRename(true);
      },
      onCancel: reason => {
        // Only an empty-name commit is a user mistake worth flagging;
        // Escape is an intentional abandon — stay silent.
        if (reason === "empty") {
          map.foliplus!.showHint(CONF.name, T("rename_empty"), HINT_DURATION.SHORT);
        }
        this.finishRename(true);
      },
    });
  }

  /**
   * Tear down an in-flight rename input, restoring the label text.
   * @param {boolean} [restoreText=true] Re-set the label text from the
   *   registry. When false, the caller will write its own text immediately
   *   after (used internally to avoid a double write).
   */
  private finishRename(restoreText = true): void {
    if (!this.activeRenameId) return;
    const layerId = this.activeRenameId;
    this.activeRenameId = null;
    if (!this.uiContainer) return;

    const layerInfo = this.m.layerRegistry.get(layerId);
    const isColorLayer = layerId === CONST.COLOR.MAP_ID;
    if (!layerInfo && !isColorLayer) return;

    const item = this.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
    ) as HTMLElement | null;
    const label = item?.querySelector("label") as HTMLLabelElement | null;
    item?.classList.remove(CONST.CLASSES.RENAMING);
    removeInlineEditInput(label);
    if (restoreText) updateItemLabel(item, this.displayName(layerId));
  }

  /**
   * Focus the map on a registered layer's bounding box.
   *
   * Best-effort approach:
   * 1. Compute bounds from the layer (fallback: forEachLeaf for containers
   *    whose getBounds delegates to children).
   * 2. If the layer is not on the map, bring it on temporarily so the bounds
   *    and the visual highlight are consistent with the user's action.
   * 3. If the bounds area is below MIN_BOUNDS_AREA (single Marker, tiny
   *    polygon, etc.), `flyTo` the layer center instead of `fitBounds` —
   *    `fitBounds` on a degenerate box has no effect.
   * 4. Draw a dashed rectangle on the exact bounds so the user sees exactly
   *    what "this layer" covers.
   * 5. Highlight the focused layer row with the `foliplus-layer-focusing`
   *    class so the list ↔ map linkage is visible.
   * 6. Call `fitBounds` with `padding` and `maxZoom` capped to current +
   *    `FOCUS.MAX_ZOOM_STEP` to avoid satellite-zoom snaps on small features.
   * 7. Auto-cancel on any subsequent map `moveend`/`zoomend` so the rect
   *    doesn't linger while the user navigates elsewhere.
   */
  focusLayer(layerId: string) {
    // Guard: any component holding the map (measuring, exporting, searching,
    // locating) blocks focus. One guard at the entry covers all call sites
    // (double-click, ⋮ menu, Alt+Enter, Enter) so none of them leak.
    if (guardBlocked(this.m.map, CONF.name, T("blocked"))) return;

    const layerInfo = this.m.layerRegistry.get(layerId);
    if (!layerInfo) return;
    const layer = this.m.findLayer(layerInfo);

    // Hidden layer: nothing to focus on — show a hint instead.
    const itemEl = this.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
    ) as HTMLElement | null;
    const checkbox = itemEl?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    if (checkbox && !checkbox.checked) {
      this.m.map.foliplus!.showHint(
        CONF.name,
        T("focus_layer_hidden"),
        HINT_DURATION.SHORT,
      );
      return;
    }

    // Bounds come from the Leaflet layer (with a forEachLeaf fallback), or
    // from a canvas layer's getBounds provider (heatmap has no Leaflet layer).
    let bounds: L.LatLngBounds | null = null;
    if (layer) {
      // Ensure the layer is on the map so the rectangle highlight is visible.
      if (!this.m.map.hasLayer(layer)) this.m.map.addLayer(layer);
      bounds = this.computeLayerBounds(layer);
    } else if (typeof layerInfo.getBounds === "function") {
      bounds = layerInfo.getBounds();
    }
    if (!bounds || !bounds.isValid()) return;

    // Cancel any in-flight focus first.
    this.dismissFocus();

    // Hide every other visible layer so the focused one stands out — including
    // layers that overlap the focused bounds (the mask only dims outside).
    this.hideOtherLayers();
    // Lift it above the hidden peers (so it can't be covered) and apply the
    // accent glow — one O(panes) pass, not a per-leaf-element loop.
    this.bringFocusedLayerToFront(layer, layerInfo.canvas ?? null);

    // Register LayerControl's own mode for the duration of the focus, BEFORE
    // the fitBounds/flyTo branching. Both paths draw a focus overlay and
    // register the same auto-cancel, so both must hold the mode — a missing
    // setMode on the flyTo path would let export/measure render through a
    // live focus overlay. Cleared on dismissFocus — called by the auto-timeout,
    // the manual cancel, and a subsequent focus (dismissFocus runs at the top
    // of focusLayer).
    ensureModes(this.m.map).setMode(CONF.name, "focusing");

    // Single-point / tiny bounds → flyTo the center.
    const southWest = bounds.getSouthWest();
    const northEast = bounds.getNorthEast();
    const area =
      Math.abs(northEast.lat - southWest.lat) * Math.abs(northEast.lng - southWest.lng);
    if (area < CONST.FOCUS.MIN_BOUNDS_AREA) {
      const center = bounds.getCenter();
      const maxZoom = Math.min(
        this.m.map.getMaxZoom(),
        this.m.map.getZoom() + CONST.FOCUS.MAX_ZOOM_STEP,
      );
      this.m.map.flyTo(center, maxZoom, {
        duration: CONST.FOCUS.FIT_DURATION,
      });
      this.highlightFocusedRow(itemEl, layerId);
      this.registerAutoCancel(layerId);
      return;
    }

    this.drawFocusMask(bounds);
    this.drawFocusRect(bounds);
    this.highlightFocusedRow(itemEl, layerId);

    this.m.map.fitBounds(bounds, {
      animate: true,
      duration: CONST.FOCUS.FIT_DURATION,
      padding: CONST.FOCUS.PADDING,
      maxZoom: Math.min(
        this.m.map.getMaxZoom(),
        this.m.map.getZoom() + CONST.FOCUS.MAX_ZOOM_STEP,
      ),
    });

    // Auto-remove focus visuals after the configured duration.
    const ref = this.focusRect;
    setTimeout(() => {
      if (this.focusRect === ref) {
        this.dismissFocus();
      }
    }, CONST.FOCUS.RECT_DURATION_MS);

    // One-shot map move/zoom handler that auto-cancels focus when the user
    // starts navigating elsewhere — prevents the rect from lingering.
    this.registerAutoCancel(layerId);
  }

  /** Return true if a focus animation is currently active. */
  isFocusing(): boolean {
    return this.focusRect != null || this.focusingLayerId != null;
  }

  /** Cancel an in-flight focus: remove rect + mask + row highlight. */
  cancelFocus(): void {
    this.dismissFocus();
    this.m.map.foliplus!.showHint(CONF.name, T("focus_cancelled"), HINT_DURATION.SHORT);
  }

  /** Internal: tear down focus visuals + state (no hint). */
  private dismissFocus(): void {
    // Release LayerControl's focus mode so other components' primary actions
    // (export, measure) are unblocked. Idempotent: safe to call even when
    // no focus was active; setMode(null) writes a null entry that the
    // interaction lock treats as inactive, emitting a MODE_CHANGE to recompute.
    ensureModes(this.m.map).setMode(CONF.name, null);
    this.clearAutoCancel();
    this.clearFocusedRowHighlight();
    this.restoreHiddenLayers();
    for (const restore of this.focusedPaneRestores) restore();
    this.focusedPaneRestores = [];

    if (this.focusRect) {
      this.m.map.removeLayer(this.focusRect);
      this.focusRect = null;
    }

    if (this.focusMask) {
      this.m.map.removeLayer(this.focusMask);
      this.focusMask = null;
    }
    // Tear down the SVG renderer too. Reusing it across focuses left the
    // previous focus's mask/rect paths in the SVG even after removeLayer,
    // so focusing layer A then B showed two boxes (stale A mask + new B
    // mask) with inverted dimming. A fresh renderer per focus is cheap and
    // guarantees a clean slate.
    if (this.focusRenderer) {
      this.m.map.removeLayer(this.focusRenderer);
      this.focusRenderer = null;
    }

    this.focusingLayerId = null;
  }

  /**
   * Hide every other visible layer so the focused layer stands out.
   * Works alongside the inverse mask (which dims the basemap + everything
   * outside the bounds). The basemap (tilePane) has no `foliplus-layer-pane`
   * class, so it is naturally excluded and keeps the spatial context.
   *
   * Declarative: one class write on the map container. CSS
   * `.foliplus-focus-active .foliplus-layer-pane:not(.foliplus-focus-pane)`
   * hides every layer pane except the focused one — instead of a JS
   * visibility loop over N panes. `bringFocusedLayerToFront` marks the
   * focused pane(s)/canvas with `foliplus-focus-pane` so they stay visible.
   */
  private hideOtherLayers(): void {
    this.m.map.getContainer().classList.add(CONST.CLASSES.FOCUS_ACTIVE);
  }

  /**
   * Temporarily lift the focused layer's pane above every other layer so the
   * hidden layers stacked above it cannot cover it — a layer at the bottom
   * of the z-order stays hidden even with the boost glow. Canvas layers
   * (heatmap) have no pane; their canvas element's z-index is lifted instead.
   *
   * This is the single O(panes) pass that also applies the focused-layer glow
   * (`.foliplus-focus-glow`): by tagging the focused pane (not each leaf
   * element) the accent drop-shadow is applied once per pane, so focusing a
   * dense layer (e.g. thousands of CircleMarkers) stays cheap. Restored on
   * cancel via focusedPaneRestores.
   */
  private bringFocusedLayerToFront(
    layer: L.Layer | null,
    canvas: HTMLCanvasElement | null,
  ): void {
    const restores: Array<() => void> = [];
    const lift = (el: HTMLElement): void => {
      const orig = el.style.zIndex;
      el.style.zIndex = String(CONST.FOCUS.PANE_Z - CONST.FOCUS.FOCUSED_Z_GAP);
      // Mark the focused pane/canvas so the `.foliplus-focus-active` CSS rule
      // (`:not(.foliplus-focus-pane)`) keeps it visible while hiding the rest.
      el.classList.add(CONST.CLASSES.FOCUS_PANE);
      // Glow: applied at pane level (one element), fading in via CSS animation.
      el.classList.add(CONST.CLASSES.FOCUS_GLOW);
      restores.push(() => {
        el.style.zIndex = orig;
        el.classList.remove(CONST.CLASSES.FOCUS_PANE);
        el.classList.remove(CONST.CLASSES.FOCUS_GLOW);
      });
    };

    if (canvas) {
      lift(canvas);
    } else if (layer) {
      // Best-effort: some third-party layers expose children without a pane
      // (getLayerPanes walks options.pane), so skip the lift if discovery
      // throws — the hide + glow still work without it.
      let panes: string[] = [];
      try {
        panes = this.m.getLayerPanes(layer);
      } catch {
        panes = [];
      }
      for (const name of panes) {
        // Skip only the shared core panes (overlay/marker/tile/...). Per-layer
        // fallback panes are unique and safe to lift — and hideOtherLayers
        // already hides them, so the two must stay symmetric.
        if (this.m.panes.defaultPanes.has(name)) continue;
        const pane = this.m.map.getPane(name);
        if (pane) lift(pane);
      }
    }
    this.focusedPaneRestores = restores;
  }

  /** Remove the container class that hides every non-focused layer. */
  private restoreHiddenLayers(): void {
    this.m.map.getContainer().classList.remove(CONST.CLASSES.FOCUS_ACTIVE);
  }

  /**
   * Compute a layer's geographic bounds. Third-party layers may be custom
   * L.Layer subclasses without a getBounds() method; fall back to summing the
   * bounds of the layer's leaf nodes so focus still works for them.
   */
  private computeLayerBounds(layer: L.Layer): L.LatLngBounds | null {
    const withBounds = layer as L.Layer & { getBounds?: () => L.LatLngBounds };
    if (typeof withBounds.getBounds === "function") {
      const b = withBounds.getBounds();
      if (b && b.isValid()) return b;
    }
    const acc = L.latLngBounds([]);
    let hasLeaf = false;
    forEachLeaf(layer, leaf => {
      const lb = (leaf as L.Layer & { getBounds?: () => L.LatLngBounds }).getBounds?.();
      if (lb && lb.isValid()) {
        acc.extend(lb);
        hasLeaf = true;
      }
    });
    return hasLeaf ? acc : null;
  }

  /**
   * Draw an inverse mask that dims everything outside the focused bounds —
   * the same "inside highlighted / outside dimmed" spotlight as the export
   * crop box. The mask is a polygon of the visible view with the layer bounds
   * as a hole, rendered in a high-z pane above the layer panes but below the
   * focus rectangle, so the focused layer inside the hole stays bright.
   */
  private drawFocusMask(bounds: L.LatLngBounds): void {
    const map = this.m.map;

    // Shared SVG renderer + pane for the mask and rectangle.
    if (!this.focusRenderer) {
      let pane = map.getPane(CONST.FOCUS_PANE);
      if (!pane) {
        pane = map.createPane(CONST.FOCUS_PANE);
        pane.style.zIndex = String(CONST.FOCUS.PANE_Z);
      }
      this.focusRenderer = L.svg({ pane: CONST.FOCUS_PANE });
      this.focusRenderer.addTo(map);
    }

    // Outer ring: the visible view bounds, padded so the dim covers the
    // viewport (a little pan during the fitBounds animation stays covered).
    const view = map.getBounds().pad(1);
    const outer: L.LatLngExpression[] = [
      view.getSouthWest(),
      view.getNorthWest(),
      view.getNorthEast(),
      view.getSouthEast(),
    ];
    // Hole: the layer bounds (the focused layer lives inside it, so it stays
    // bright while everything else is dimmed by the mask).
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const hole: L.LatLngExpression[] = [
      sw,
      L.latLng(ne.lat, sw.lng),
      ne,
      L.latLng(sw.lat, ne.lng),
    ];

    this.focusMask = L.polygon([outer, hole], {
      className: "foliplus-focus-mask",
      fillColor: "#000000",
      fillOpacity: CONST.FOCUS.MASK_OPACITY,
      stroke: false,
      interactive: false,
      renderer: this.focusRenderer,
    });
    map.addLayer(this.focusMask);
  }

  /** Draw the dashed focus rectangle (border only, no fill). */
  private drawFocusRect(bounds: L.LatLngBounds): void {
    const map = this.m.map;

    this.focusRect = L.rectangle(bounds, {
      className: "foliplus-focus-rect",
      fill: false,
      interactive: false,
      renderer: this.focusRenderer ?? undefined,
    });
    map.addLayer(this.focusRect);
  }

  /** Register a one-shot moveend/zoomend handler that auto-cancels focus. */
  private registerAutoCancel(layerId: string): void {
    this.focusingLayerId = layerId;
    const self = this;
    const handler = () => {
      if (self.focusingLayerId !== layerId) return;
      // Grace period: the fitBounds/flyTo animation fires moveend/zoomend on
      // completion, which should NOT auto-cancel. Any move/zoom *after* the
      // grace window is a deliberate user action → cancel.
      setTimeout(() => {
        if (self.focusingLayerId === layerId) {
          self.dismissFocus();
        }
      }, CONST.FOCUS.RECT_DURATION_MS * 0.3);
    };
    this.onFocusMapMove = () => handler();
    this.m.map.on("moveend", this.onFocusMapMove);
    this.m.map.on("zoomend", this.onFocusMapMove);
  }

  /** Remove the map move/zoom auto-cancel handlers. */
  private clearAutoCancel(): void {
    if (this.onFocusMapMove) {
      this.m.map.off("moveend", this.onFocusMapMove);
      this.m.map.off("zoomend", this.onFocusMapMove);
      this.onFocusMapMove = null;
    }
  }

  /** Highlight the layer row that is being focused (list ↔ map linkage). */
  private highlightFocusedRow(itemEl: HTMLElement | null, layerId: string): void {
    this.clearFocusedRowHighlight();
    if (!itemEl) return;
    itemEl.classList.add(CONST.CLASSES.FOCUSING);
    this.focusingLayerId = layerId;
  }

  /** Remove the `foliplus-layer-focusing` class from the active row. */
  private clearFocusedRowHighlight(): void {
    const prev = this.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSING}`);
    prev?.classList.remove(CONST.CLASSES.FOCUSING);
  }

  deselectAllBaseMaps(exceptIdx: number) {
    const inputs = this.uiContainer.querySelectorAll(
      `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.COLOR_ITEM}) input`,
    ) as NodeListOf<HTMLInputElement>;
    for (let i = 0; i < this.m.layers.length; i++)
      if (this.m.layers[i].isBase && i !== exceptIdx) {
        const bLayer = this.m.findLayer(this.m.layers[i]);
        if (bLayer && this.m.map.hasLayer(bLayer)) this.m.map.removeLayer(bLayer);
        if (inputs[i]) {
          inputs[i].checked = false;
          inputs[i]
            .closest(CONST.SEL.LAYER_ITEM)
            ?.classList.remove(CONST.CLASSES.ACTIVE);
        }
      }
  }
}

export { LayerUI };
