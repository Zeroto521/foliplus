import { HINT_DURATION } from "#core/hint.js";
import { GEOM_TYPE, getGeometryType } from "#core/layer/index.js";
import { dom, escapeHTML } from "#common/dom.js";
import * as Icons from "#common/icon.js";
import { createTranslator } from "#common/locale.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";
import * as SVGs from "./icon.js";
import type { LayerManager } from "./manager.js";
import * as Util from "./util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const _ = createTranslator(CONF);
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
  declare onChange: ((event: Event) => void) | null;
  declare onInput: ((event: Event) => void) | null;
  declare onClick: ((event: Event) => void) | null;
  declare onDragStart: ((event: DragEvent) => void) | null;
  declare onDragOver: ((event: DragEvent) => void) | null;
  declare onDragLeave: ((event: DragEvent) => void) | null;
  declare onDragEnd: ((event: DragEvent) => void) | null;
  declare onDrop: ((event: DragEvent) => void) | null;
  declare onKeyDown: ((event: KeyboardEvent) => void) | null;

  constructor(manager: LayerManager) {
    this.manager = manager;
    this.foldedGroups = new Set();
    this.isColorActive = false;
    this.currentColor = CONST.COLOR.DEFAULT;
    this.dragIdx = null;
    this.lastDragHintAt = 0;
    this.lastDragOverItem = null;
    this.activeIdx = null;
  }

  /** Alias for convenience */
  get m() {
    return this.manager;
  }

  /** The attached panel container. Only valid after attachUI(). */
  get uiContainer(): HTMLElement {
    return this.m.uiContainer!;
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
          this.renderToggleAllRow(CONST.GROUP.OVERLAY, `${CONF.name}.data_layer_label`),
        );
      }
      if (layerInfo.isBase && !hasBaseMaps) {
        hasBaseMaps = true;
        frag.appendChild(
          this.renderToggleAllRow(CONST.GROUP.BASE, `${CONF.name}.base_map_label`),
        );
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
          group === CONST.GROUP.BASE
            ? `${CONF.name}.base_map_label`
            : `${CONF.name}.data_layer_label`,
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
        title: _(`${CONF.name}.${isFolded ? "unfold_tooltip" : "fold_tooltip"}`),
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
          title: _(`${CONF.name}.toggle_all_deselect_tooltip`),
        }),
      ),
      dom.el("span", { class: CONST.CLASSES.SEP_LABEL }, _(labelKey)),
      dom.el("div", { class: "foliplus-section-divider" }),
    );
  }

  renderLayerItem(layerInfo: LayerInfo, idx: number) {
    const en = escapeHTML(layerInfo.name);
    const children: (HTMLElement | { html: string })[] = [
      dom.el(
        "span",
        { title: _(`${CONF.name}.drag_tooltip`) },
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
      dom.el("label", null, en),
    ];
    if (layerInfo.iconSvg)
      children.push({
        html: `<div class="${CONST.CLASSES.TYPE_ICON_COL}">${layerInfo.iconSvg}</div>`,
      });
    else children.push(dom.el("div", { class: CONST.CLASSES.TYPE_ICON_COL }));
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
    return dom.el(
      "div",
      {
        class: `${CONST.CLASSES.LAYER_ITEM} ${CONST.CLASSES.COLOR_ITEM}`,
        draggable: "false",
        [CONST.DATA.LAYER_ID]: CONST.COLOR.MAP_ID,
        title: _(`${CONF.name}.color_map_label`),
      },
      { html: SVGs.DRAG_HANDLE },
      dom.el(
        "div",
        { class: CONST.CLASSES.CHECKBOX },
        dom.el("input", {
          type: "color",
          class: CONST.CLASSES.COLOR_INPUT,
          value: this.currentColor,
          "aria-label": _(`${CONF.name}.color_map_label`),
        }),
      ),
      dom.el("label", null, _(`${CONF.name}.color_map_label`)),
      { html: `<div class="${CONST.CLASSES.TYPE_ICON_COL}">${SVGs.COLOR}</div>` },
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

      input.title = _(
        `${CONF.name}.${input.checked ? "deselect_tooltip" : "select_tooltip"}`,
      );

      const item = input.closest(CONST.SEL.LAYER_ITEM);
      if (item) {
        if (input.checked) item.classList.add(CONST.CLASSES.ACTIVE);
        else item.classList.remove(CONST.CLASSES.ACTIVE);
      }
    }

    if (typeCol) {
      let typeKey: string;
      if (layerInfo.isBase) {
        typeCol.innerHTML = Icons.GLOBE;
        typeKey = `${CONF.name}.type_base`;
        layerInfo.type = CONST.GROUP.BASE;
        if (input?.checked) baseVisible = true;
      } else if (layerInfo.iconSvg) {
        typeCol.innerHTML = layerInfo.iconSvg;
        typeKey = `${CONF.name}.type_custom`;
        layerInfo.type = GEOM_TYPE.CUSTOM;
      } else if (layer) {
        const gtype = getGeometryType(layer);
        typeCol.innerHTML = Util.getTypeSVG(layer);
        typeKey = `${CONF.name}.type_${gtype}`;
        layerInfo.type = gtype;
      } else typeKey = `${CONF.name}.type_unknown`;

      const item = input?.closest(CONST.SEL.LAYER_ITEM) as HTMLElement | undefined;
      if (item) item.title = _(typeKey);
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
      this.saveFoldState();
    };

    this.onDragStart = event => this.handleDragStart(event);
    this.onDragOver = event => this.handleDragOver(event);
    this.onDragLeave = event => this.handleDragLeave(event);
    this.onDrop = event => this.handleDrop(event);
    this.onDragEnd = () => this.handleDragEnd();
    this.onKeyDown = event => this.handleKeyDown(event);

    container.addEventListener("change", this.onChange);
    container.addEventListener("input", this.onInput);
    container.addEventListener("click", this.onClick);
    container.addEventListener("dragstart", this.onDragStart);
    container.addEventListener("dragover", this.onDragOver);
    container.addEventListener("dragleave", this.onDragLeave);
    container.addEventListener("drop", this.onDrop);
    container.addEventListener("dragend", this.onDragEnd);
    container.addEventListener("keydown", this.onKeyDown);
  }

  unbindEvents() {
    const container = this.uiContainer;
    if (!container) return;
    if (this.onChange) container.removeEventListener("change", this.onChange);
    if (this.onInput) container.removeEventListener("input", this.onInput);
    if (this.onClick) container.removeEventListener("click", this.onClick);
    if (this.onDragStart) container.removeEventListener("dragstart", this.onDragStart);
    if (this.onDragOver) container.removeEventListener("dragover", this.onDragOver);
    if (this.onDragLeave) container.removeEventListener("dragleave", this.onDragLeave);
    if (this.onDrop) container.removeEventListener("drop", this.onDrop);
    if (this.onDragEnd) container.removeEventListener("dragend", this.onDragEnd);
    if (this.onKeyDown) container.removeEventListener("keydown", this.onKeyDown);
    this.clearActiveItem();
    this.onChange = this.onInput = this.onClick = null;
    this.onDragStart = this.onDragOver = this.onDragLeave = null;
    this.onDrop = this.onDragEnd = null;
    this.onKeyDown = null;
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
      checkbox.title = _(
        `${CONF.name}.${newState ? "deselect_tooltip" : "select_tooltip"}`,
      );
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
    this.m.enforceOrder();
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
    allCb.title = _(
      `${CONF.name}.${allChecked || allCb.indeterminate ? "toggle_all_deselect_tooltip" : "toggle_all_select_tooltip"}`,
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

    target.title = _(
      `${CONF.name}.${target.checked ? "deselect_tooltip" : "select_tooltip"}`,
    );

    if (layerInfo.onToggle) layerInfo.onToggle(target.checked);
    this.syncVisibility(layerInfo, layer, target.checked);

    this.syncToggleAll(layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY);
    this.m.enforceOrder();
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
          map.foliplus!.showHint(
            CONF.name,
            _(CONF.name + ".reorder_top"),
            HINT_DURATION.SHORT,
          );
        }
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        const moved = this.m.moveLayerDown(id);
        if (!moved) {
          map.foliplus!.showHint(
            CONF.name,
            _(CONF.name + ".reorder_bottom"),
            HINT_DURATION.SHORT,
          );
        }
      }
      const newItems = this.getNavigableItems();
      this.activeIdx = newItems.findIndex(
        el => el.getAttribute(CONST.DATA.LAYER_ID) === id,
      );
      return;
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
        event.preventDefault();
        this.toggleFocusedLayer();
        break;
      case "Escape":
        this.clearActiveItem();
        break;
    }
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
    map.foliplus!.showHint(
      CONF.name,
      _(`${CONF.name}.reorder_group_only`),
      HINT_DURATION.SHORT,
    );
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
