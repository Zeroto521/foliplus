import { EVENTS, ensureEvents } from "#core/event/index.js";
import { HINT_DURATION } from "#core/hint.js";
import { GEOM_TYPE, forEachLeaf, getGeometryType } from "#core/layer/index.js";
import { dom, escapeHTML } from "#common/dom.js";
import { type NumberStyle, formatNumber } from "#common/format.js";
import * as Icons from "#common/icon.js";
import { createScopedTranslator } from "#common/locale.js";
import * as Storage from "#common/storage.js";
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
const mapContainer = map.getContainer();

/** UI Controller for LayerControl. Handles DOM rendering, events, and drag-and-drop. */
class LayerUI {
  manager: LayerManager;
  foldedGroups: Set<string>;
  isColorActive: boolean;
  currentColor: string;
  dragIdx: number | null;
  lastDragHintAt: number;
  lastDragOverItem: HTMLElement | null;
  activeIdx: number | null;
  private interactionCleanup?: () => void;
  declare onChange: ((event: Event) => void) | null;
  declare onInput: ((event: Event) => void) | null;
  declare onClick: ((event: Event) => void) | null;
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
  /** Restore callbacks for layers dimmed during focus (cleared on cancel). */
  private dimmedLayers: Array<() => void>;
  /** Restore callback for the focused layer's boost glow (cleared on cancel). */
  private focusedBoostRestore: (() => void) | null;
  /** Restore callbacks for pane z-indexes lifted to bring the focused layer
   *  to the front (cleared on cancel). */
  private focusedPaneRestores: Array<() => void>;

  constructor(manager: LayerManager) {
    this.manager = manager;
    this.foldedGroups = new Set();
    this.isColorActive = false;
    this.currentColor = CONST.COLOR.DEFAULT;
    this.dragIdx = null;
    this.lastDragHintAt = 0;
    this.lastDragOverItem = null;
    this.activeIdx = null;
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
    this.dimmedLayers = [];
    this.focusedBoostRestore = null;
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
    this.renderInitialList();
    this.bindEvents();

    while (this.m.pendingRegistrations.length) {
      const layerInfo = this.m.pendingRegistrations.shift();
      if (layerInfo) this.insertLayerItem(layerInfo, { reindex: false });
    }
    this.reindexItems();

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
    const data = Storage.load<string[]>(CONST.STORAGE.FOLD_KEY, CONF.name);
    if (Array.isArray(data)) this.foldedGroups = new Set(data);
  }

  /** Save fold state to localStorage. */
  saveFoldState() {
    Storage.save(CONST.STORAGE.FOLD_KEY, Array.from(this.foldedGroups), CONF.name);
  }

  renderInitialList() {
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
  }

  updateLayerItem(layerInfo: LayerInfo, idx: number) {
    const item = this.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerInfo.id)}"]`,
    ) as HTMLElement | null;
    if (!item) return;
    item.dataset.index = String(idx);
    const label = item.querySelector("label");
    if (label) label.textContent = layerInfo.name;
    const checkbox = item.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    if (checkbox) {
      checkbox.dataset.index = String(idx);
      checkbox.setAttribute("aria-label", escapeHTML(layerInfo.name));
      checkbox.title = escapeHTML(layerInfo.name);
    }
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
    const en = escapeHTML(layerInfo.name);

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
    // Only overlay (data) layers get the "more" button. Base maps cover the
    // whole world (focusing is a no-op) and solid-color layers have no
    // meaningful bounds. `hidden="hidden"` removes it from layout + a11y tree.
    if (layerInfo.isBase) moreBtn.setAttribute("hidden", "hidden");

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
          "aria-label": en,
          title: en,
        }),
      ),
      dom.el("label", { class: CONST.CLASSES.LAYER_LABEL }, en),
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

  renderColorLayerItem() {
    const colorInput = dom.el("input", {
      type: "color",
      class: CONST.CLASSES.COLOR_INPUT,
      value: this.currentColor,
      "aria-label": T("color_map_label"),
    });

    return dom.el(
      "div",
      {
        class: `${CONST.CLASSES.LAYER_ITEM} ${CONST.CLASSES.COLOR_ITEM}`,
        draggable: "false",
        [CONST.DATA.LAYER_ID]: CONST.COLOR.MAP_ID,
        title: T("color_map_label"),
      },
      dom.el("span", { class: CONST.CLASSES.DRAG_CELL }, { html: SVGs.DRAG_HANDLE }),
      dom.el("div", { class: CONST.CLASSES.CHECKBOX }, colorInput),
      dom.el("label", { class: CONST.CLASSES.LAYER_LABEL }, T("color_map_label")),
      // count column is empty (color layers have no feature count).
      dom.el("span", { class: CONST.CLASSES.COUNT_COL }),
      dom.el("div", { class: CONST.CLASSES.TYPE_ICON_COL, innerHTML: SVGs.COLOR }),
      // Solid-color layer has no meaningful bounds — no overflow menu.
    );
  }

  /** Initialize one layer row's checkbox + type icon (incremental path).
   *  @returns {boolean} true when the row is a visible base layer. */
  initLayerItem(layerInfo: LayerInfo): boolean {
    const idx = this.m.layerRegistry.indexOf(layerInfo);
    if (idx === -1) return false;
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

  /** Full re-scan of every row (used on attach/fold-toggle). */
  initTypesAndVisibility() {
    let anyBaseVisible = false;
    for (let i = 0; i < this.m.layers.length; i++) {
      if (this.initLayerItem(this.m.layers[i])) anyBaseVisible = true;
    }

    if (!anyBaseVisible) this.showColorLayer(this.currentColor);
    this.m.enforceOrder();
    this.syncToggleAll(CONST.GROUP.OVERLAY);
    this.syncToggleAll(CONST.GROUP.BASE);
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
      if ((event.target as HTMLElement).closest(CONST.SEL.COLOR_ITEM)) {
        this.deselectAllBaseMaps(-1);
        this.showColorLayer(this.currentColor);
        this.syncToggleAll(CONST.GROUP.BASE);
        this.m.enforceOrder();
        return;
      }
      const row = (event.target as HTMLElement).closest(
        CONST.SEL.TOGGLE_ALL,
      ) as HTMLElement | null;
      if (!row || (event.target as HTMLElement).closest('[data-role="toggle-all"]'))
        return;
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
    this.interactionCleanup = registerInteractions(this);

    container.addEventListener("change", this.onChange);
    container.addEventListener("input", this.onInput);
    container.addEventListener("click", this.onClick);
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
    // Remove any focus animation still in flight (rect + row highlight).
    this.dismissFocus();
    if (this.onChange) container.removeEventListener("change", this.onChange);
    if (this.onInput) container.removeEventListener("input", this.onInput);
    if (this.onClick) container.removeEventListener("click", this.onClick);
    if (this.onDragStart) container.removeEventListener("dragstart", this.onDragStart);
    if (this.onDragOver) container.removeEventListener("dragover", this.onDragOver);
    if (this.onDragLeave) container.removeEventListener("dragleave", this.onDragLeave);
    if (this.onDrop) container.removeEventListener("drop", this.onDrop);
    if (this.onDragEnd) container.removeEventListener("dragend", this.onDragEnd);
    if (this.onMoreClick) container.removeEventListener("click", this.onMoreClick);
    if (this.onMoreMenuClick)
      document.removeEventListener("click", this.onMoreMenuClick);
    if (this.onMoreMapClick) this.m.map.off("click", this.onMoreMapClick);
    // The focus SVG renderer is kept alive across focuses to avoid recreating
    // it (L.svg + addTo) on every click, but it must be removed when the
    // control is destroyed — otherwise it leaks in the map's overlay pane.
    if (this.focusRenderer) {
      this.m.map.removeLayer(this.focusRenderer);
      this.focusRenderer = null;
    }
    this.clearActiveItem();
    this.interactionCleanup?.();
    this.onChange = this.onInput = this.onClick = null;
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
    });

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

    this.syncToggleAll(layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY);
    this.m.debouncedEnforce();
  }

  handleInput(event: Event) {
    if ((event.target as HTMLElement).classList.contains(CONST.CLASSES.COLOR_INPUT))
      this.showColorLayer((event.target as HTMLInputElement).value);
  }

  /** Get all navigable layer items (excludes color item and toggle-all rows). */
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

  /** Get the currently focused layer item element. */
  getActiveLayerItem(): HTMLElement | null {
    if (this.activeIdx === null) return null;
    return this.getNavigableItems()[this.activeIdx] ?? null;
  }

  /** Set the active item index and apply focus styling. */
  setActiveItem(idx: number): void {
    this.clearActiveItem();
    if (idx < 0 || idx >= this.getNavigableItems().length) {
      this.activeIdx = null;
      return;
    }
    this.activeIdx = idx;
    const item = this.getNavigableItems()[idx];
    if (item) {
      item.classList.add(CONST.CLASSES.FOCUSED);
      item.focus();
    }
  }

  /** Remove focus styling from the currently active item. */
  blurActiveItem(): void {
    const item = this.getActiveLayerItem();
    if (item) item.classList.remove(CONST.CLASSES.FOCUSED);
  }

  /** Clear the active item state. */
  clearActiveItem(): void {
    this.blurActiveItem();
    this.activeIdx = null;
  }

  /** Reindex all layer items after a move, preserving the active focus position. */
  reindexAfterMove(): void {
    this.renderInitialList();
    this.initTypesAndVisibility();
    this.refreshAllCounts();
    if (this.activeIdx !== null) {
      const items = this.getNavigableItems();
      if (this.activeIdx < items.length) {
        items[this.activeIdx].classList.add(CONST.CLASSES.FOCUSED);
        items[this.activeIdx].focus();
      }
    }
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

    if (this.activeIdx === null) {
      const focused = document.activeElement;
      if (focused) {
        const item =
          focused.closest(CONST.SEL.LAYER_ITEM) ??
          focused.closest(CONST.SEL.TOGGLE_ALL);
        if (item) {
          this.activeIdx = items.indexOf(item as HTMLElement);
          if (this.activeIdx === -1) return;
        } else return;
      } else return;
    }

    if (event.ctrlKey || event.metaKey) {
      const item = items[this.activeIdx];
      if (!item) return;
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
      this.activeIdx = newItems.findIndex(
        el => el.getAttribute(CONST.DATA.LAYER_ID) === id,
      );
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
        if (this.activeIdx > 0) {
          this.setActiveItem(this.activeIdx - 1);
        }
        break;
      case "ArrowDown":
        event.preventDefault();
        if (this.activeIdx < items.length - 1) {
          this.setActiveItem(this.activeIdx + 1);
        }
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
          if (menuLi.getAttribute("disabled")) {
            this.m.map.foliplus!.showHint(
              CONF.name,
              T("focus_layer_hidden"),
              HINT_DURATION.SHORT,
            );
            break;
          }
          this.focusLayer(this.activeMenu.layerId);
          this.closeMoreMenu(true);
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
   * Only overlay (data) layers have this button; base/color layers do not.
   */
  openMoreMenu(item: HTMLElement) {
    // Close any previously open menu first.
    this.closeMoreMenu(true);

    const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
    const menu = dom.el("ul", { class: "foliplus-layer-more-menu open", role: "menu" });

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

    // Dim every other visible layer so the focused one stands out — including
    // layers that overlap the focused bounds (the mask only dims outside).
    this.dimOtherLayers(layerId);
    // Positive boost so a grey focused layer still pops against grey ghosts,
    // and lift it above the dimmed layers so they can't cover it.
    this.boostFocusedLayer(layer ?? layerInfo.canvas ?? null);
    this.bringFocusedLayerToFront(layer, layerInfo.canvas ?? null);

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
    this.drawFocusRect(bounds, layerId);
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
    this.clearAutoCancel();
    this.clearFocusedRowHighlight();
    this.restoreDimmedLayers();
    this.focusedBoostRestore?.();
    this.focusedBoostRestore = null;
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
    // Keep the SVG renderer alive across focuses: recreating it (L.svg +
    // addTo(map)) on every click is synchronous DOM churn and is a large part
    // of the perceived click jank. The pane persists anyway; the renderer is
    // just re-used and new mask/rect layers are added into it next focus.

    this.focusingLayerId = null;
  }

  /**
   * Dim every other visible overlay layer so the focused layer stands out.
   * Works alongside the inverse mask (which dims the basemap + everything
   * outside the bounds). Base maps are skipped — dimming them would grey out
   * the whole basemap, including inside the hole, killing the spotlight and
   * making inside as dark as outside.
   *
   * Dims at the pane level rather than filtering individual SVG paths:
   * per-path CSS filters create stacking contexts that lift the graph pane
   * above sibling label panes (e.g. MeasureControl labels getting covered by
   * their own graph). Canvas layers (heatmap) have no Leaflet layer or pane,
   * so their canvas element is dimmed directly.
   */
  private dimOtherLayers(focusedLayerId: string): void {
    for (const layerInfo of this.m.layers) {
      if (layerInfo.isBase || layerInfo.id === focusedLayerId) continue;

      if (layerInfo.canvas) {
        const restore = this.applyElementFilter(
          layerInfo.canvas,
          CONST.FOCUS.DIM_FILTER,
        );
        if (restore) this.dimmedLayers.push(restore);
        continue;
      }

      const layer = this.m.findLayer(layerInfo);
      if (!layer || !this.m.map.hasLayer(layer)) continue;

      for (const paneName of this.m.getLayerPanes(layer)) {
        if (this.m.panes.defaultPanes.has(paneName)) continue;
        const pane = this.m.map.getPane(paneName) as HTMLElement | undefined;
        const restore = this.applyElementFilter(pane ?? null, CONST.FOCUS.DIM_FILTER);
        if (restore) this.dimmedLayers.push(restore);
      }
    }
  }

  /** Apply a CSS filter to a DOM element and return a restore callback. */
  private applyElementFilter(
    el: HTMLElement | null,
    filter: string,
  ): (() => void) | null {
    if (!el) return null;
    const orig = el.style.filter;
    el.style.filter = filter;
    return () => {
      el.style.filter = orig;
    };
  }

  /**
   * Apply a CSS filter to a layer's rendered element and return a restore
   * callback (or null if it has no element). Handles vector paths / markers
   * (getElement), tile/grid layers (getContainer) and groups (eachLayer).
   */
  private applyLayerFilter(layer: L.Layer, filter: string): (() => void) | null {
    // Vector path or marker: the SVG path / icon element.
    const el = (
      layer as L.Layer & { getElement?: () => HTMLElement | null }
    ).getElement?.();
    if (el) return this.applyElementFilter(el, filter);

    // Tile / Grid layer: the tile container div.
    const container = (
      layer as L.Layer & { getContainer?: () => HTMLElement }
    ).getContainer?.();
    if (container) return this.applyElementFilter(container, filter);

    // LayerGroup / FeatureGroup: recurse into children.
    if (typeof (layer as L.LayerGroup).eachLayer === "function") {
      const restores: Array<(() => void) | null> = [];
      (layer as L.LayerGroup).eachLayer(child => {
        restores.push(this.applyLayerFilter(child, filter));
      });
      return () => restores.forEach(r => r?.());
    }

    return null;
  }

  /** Give the focused layer a positive "selected" glow so it stands out even
   *  when it is grey (dimming alone greys colour but leaves grey unchanged).
   *  Accepts a Leaflet layer or a canvas element (canvas layers have no layer). */
  private boostFocusedLayer(target: L.Layer | HTMLElement | null): void {
    this.focusedBoostRestore =
      target instanceof HTMLElement
        ? this.applyElementFilter(target, CONST.FOCUS.FOCUS_FILTER)
        : target
          ? this.applyLayerFilter(target, CONST.FOCUS.FOCUS_FILTER)
          : null;
  }

  /**
   * Temporarily lift the focused layer's pane above every other layer so the
   * dimmed grey layers stacked on top cannot cover it — a layer at the bottom
   * of the z-order stays hidden even with the boost glow. Canvas layers
   * (heatmap) have no pane; their canvas element's z-index is lifted instead.
   * Restored on cancel via focusedPaneRestores.
   */
  private bringFocusedLayerToFront(
    layer: L.Layer | null,
    canvas: HTMLCanvasElement | null,
  ): void {
    const restores: Array<() => void> = [];
    const lift = (el: HTMLElement): void => {
      const orig = el.style.zIndex;
      el.style.zIndex = String(CONST.FOCUS.PANE_Z - 10);
      restores.push(() => {
        el.style.zIndex = orig;
      });
    };

    if (canvas) {
      lift(canvas);
    } else if (layer) {
      // Best-effort: some third-party layers expose children without a pane
      // (getLayerPanes walks options.pane), so skip the lift if discovery
      // throws — the boost + dim still work without it.
      let panes: string[] = [];
      try {
        panes = this.m.getLayerPanes(layer);
      } catch {
        panes = [];
      }
      for (const name of panes) {
        // Skip only the shared core panes (overlay/marker/tile/...). Per-layer
        // fallback panes are unique and safe to lift — and dimOtherLayers
        // already dims them, so the two must stay symmetric.
        if (this.m.panes.defaultPanes.has(name)) continue;
        const pane = this.m.map.getPane(name);
        if (pane) lift(pane);
      }
    }
    this.focusedPaneRestores = restores;
  }

  /** Restore all layers dimmed during the current focus. */
  private restoreDimmedLayers(): void {
    for (const restore of this.dimmedLayers) restore();
    this.dimmedLayers = [];
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
  private drawFocusRect(bounds: L.LatLngBounds, layerId: string): void {
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
