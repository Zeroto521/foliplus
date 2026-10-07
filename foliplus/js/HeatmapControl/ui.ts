// HeatmapControl UI building — standalone functions.
// All internal refs use direct function calls instead of `this.`.
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { HINT_DURATION } from "#core/hint.js";
import { adjustPanelZIndex } from "#core/leaflet/index.js";
import { dom } from "#common/dom.js";
import * as CONST from "./const.js";
import { registerDropdownEvents, registerSchemeBarEvents } from "./interaction.js";
import { type HeatmapManager } from "./manager.js";
import { panelContentHTML } from "./template.js";

/** Shape of the HeatmapControl instance as consumed by UI functions. */
interface HeatmapControlUI {
  mgr: HeatmapManager;
  /** BaseControl.on — DOM listeners bound through the control's mounting
   *  signal, so a removed control tears them down with everything else. */
  on: (
    target: EventTarget,
    type: string,
    fn: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ) => () => void;
  /** Component config — carried on the state object instead of a module-level
   *  free variable, so every UI function is unit-testable with its own CONFIG. */
  config: ComponentConfig;
  /** Translator bound to `config`, created once by the control / test fixture. */
  T: (key: string) => string;
  ctrl: HTMLElement;
  schemeDropdown: HTMLElement | null;
  expandHookDone: boolean;
  schemeBarCleanup: (() => void) | null;
  dropdownCleanup: (() => void) | null;
  toggleDropdown: (() => void) | null;
  selectScheme: ((idx: number) => void) | null;
  observer: MutationObserver | null;
  layerSelect: HTMLSelectElement;
  extraBody: HTMLElement;
  aggSelect: HTMLSelectElement;
  fieldWrap: HTMLElement;
  fieldSelect: HTMLSelectElement;
  methodSelect: HTMLSelectElement;
  classSelect: HTMLSelectElement;
  schemeControlWrap: HTMLElement;
  schemeBar: HTMLElement;
  schemeBarInner: HTMLElement;
  schemeSelectHidden: HTMLSelectElement;
  /** Takes `Event`, not `MouseEvent`, because it is handed to `on()` as an
   *  `EventListener` — only `.target` is read. */
  closeSchemeDropdown: (event: Event) => void;
  toggleSchemeDropdown: () => void;
}

/** Save the current config after any user-initiated change. */
const persist = (ctrl: HeatmapControlUI) => {
  ctrl.mgr.saveConfig();
  // Field/layer changes rewrite the canvas — mirror source layer + field into
  // the attrs panel and stamp Updated so the panel tracks the latest render.
  ctrl.mgr.syncSourceMeta();
};

const bindControls = (ctrl: HeatmapControlUI, panelContent: HTMLElement) => {
  panelContent.innerHTML = panelContentHTML(ctrl.T);

  // Restore saved configuration before setting initial values.
  const saved = ctrl.mgr.loadSavedConfig();
  if (saved) ctrl.mgr.applySavedConfig(saved);

  // Query key elements from the template using DATA_ATTR constants
  ctrl.layerSelect = panelContent.querySelector(
    `[${CONST.DATA_ATTR.LAYER}]`,
  ) as HTMLSelectElement;
  ctrl.extraBody = panelContent.querySelector(
    `[${CONST.DATA_ATTR.EXTRA_BODY}]`,
  ) as HTMLElement;
  ctrl.aggSelect = panelContent.querySelector(
    `[${CONST.DATA_ATTR.AGG}]`,
  ) as HTMLSelectElement;
  ctrl.fieldWrap = panelContent.querySelector(
    `[${CONST.DATA_ATTR.FIELD}]`,
  ) as HTMLElement;
  ctrl.fieldSelect = panelContent.querySelector(
    `[${CONST.DATA_ATTR.FIELD_SELECT}]`,
  ) as HTMLSelectElement;
  ctrl.methodSelect = panelContent.querySelector(
    `[${CONST.DATA_ATTR.METHOD}]`,
  ) as HTMLSelectElement;
  ctrl.classSelect = panelContent.querySelector(
    `[${CONST.DATA_ATTR.CLASS_COUNT}]`,
  ) as HTMLSelectElement;
  ctrl.schemeControlWrap = panelContent.querySelector(
    `[${CONST.DATA_ATTR.SCHEME_CTRL}]`,
  ) as HTMLElement;
  ctrl.schemeBar = ctrl.schemeControlWrap.querySelector(
    CONST.SEL.SCHEME_BAR,
  ) as HTMLElement;
  ctrl.schemeBarInner = ctrl.schemeControlWrap.querySelector(
    CONST.SEL.SCHEME_BAR_INNER,
  ) as HTMLElement;
  ctrl.schemeSelectHidden = panelContent.querySelector(
    `[${CONST.DATA_ATTR.SCHEME_HIDDEN}]`,
  ) as HTMLSelectElement;

  // Set initial values from manager defaults
  ctrl.classSelect.value = String(
    Math.min(
      CONST.CLASS_COUNT.MAX,
      Math.max(CONST.CLASS_COUNT.MIN, ctrl.mgr.numClasses),
    ),
  );
  ctrl.methodSelect.value = ctrl.mgr.currentMethod;
  ctrl.aggSelect.value = ctrl.mgr.currentAgg;

  // Populate scheme options and set current value
  (ctrl.config.schemes ?? []).forEach(name => {
    dom.el("option", { value: name, parent: ctrl.schemeSelectHidden }, name);
  });
  ctrl.schemeSelectHidden.value = ctrl.mgr.currentScheme;

  ctrl.aggSelect.onchange = () => {
    ctrl.mgr.currentAgg = ctrl.aggSelect.value;
    updateFieldSelector(ctrl);
    ctrl.mgr.renderHexagons();
    persist(ctrl);
  };

  ctrl.fieldSelect.onchange = () => {
    ctrl.mgr.currentField = ctrl.fieldSelect.value;
    syncSelect(ctrl, ctrl.fieldSelect, ctrl.fieldSelect.value);
    ctrl.mgr.renderHexagons();
    persist(ctrl);
    ctrl.mgr.events.emit(EVENTS.LAYER_STYLE_CHANGE, { id: ctrl.mgr.layerId });
  };

  ctrl.methodSelect.onchange = () => {
    ctrl.mgr.currentMethod = ctrl.methodSelect.value;
    ctrl.mgr.renderHexagons();
    persist(ctrl);
  };

  ctrl.classSelect.onchange = () => {
    ctrl.mgr.numClasses = Math.min(
      CONST.CLASS_COUNT.MAX,
      Math.max(
        CONST.CLASS_COUNT.MIN,
        parseInt(ctrl.classSelect.value, 10) || CONST.CLASS_COUNT.DEFAULT,
      ),
    );
    updateSchemeBar(ctrl);
    if (ctrl.schemeDropdown) refreshSchemeDropdownItems(ctrl);
    ctrl.mgr.renderHexagons();
    persist(ctrl);
  };

  ctrl.schemeBar.onclick = event => {
    event.stopPropagation();
    toggleSchemeDropdown(ctrl);
  };
  ctrl.schemeBarCleanup = registerSchemeBarEvents(ctrl.mgr.map, ctrl);
  ctrl.toggleDropdown = () => toggleSchemeDropdown(ctrl);
  ctrl.selectScheme = (idx: number) => {
    const name = (ctrl.config.schemes ?? [])[idx];
    if (name) selectScheme(ctrl, name);
  };

  ctrl.schemeSelectHidden.onchange = () => {
    ctrl.mgr.currentScheme = ctrl.schemeSelectHidden.value;
    updateSchemeBar(ctrl);
    ctrl.mgr.renderHexagons();
    persist(ctrl);
  };

  ctrl.closeSchemeDropdown = (event: Event) => {
    if (
      ctrl.schemeDropdown &&
      !ctrl.schemeBar.contains(event.target as Node) &&
      !ctrl.schemeDropdown.contains(event.target as Node)
    ) {
      ctrl.schemeDropdown.remove();
      ctrl.schemeDropdown = null;
      ctrl.schemeBar.classList.remove(CONST.CLASSES.SCHEME_BAR_OPEN);
    }
  };
  ctrl.toggleSchemeDropdown = () => {
    toggleSchemeDropdown(ctrl);
    // Document-level outside-click, bound through the control's signal so a
    // control removed with the dropdown open leaves no listener behind. The
    // handler no-ops when no dropdown is open, so re-registering on each open
    // is idempotent rather than additive.
    if (ctrl.schemeDropdown) {
      ctrl.on(document, "click", ctrl.closeSchemeDropdown);
    }
  };

  const clearBtn = panelContent.querySelector(
    `[${CONST.DATA_ATTR.BTN_CLEAR}]`,
  ) as HTMLButtonElement;
  clearBtn.onclick = () => {
    resetPanel(ctrl);
    ctrl.mgr.clearSavedConfig();
    ctrl.mgr.clearLayerState();
    ctrl.ctrl.classList.remove(CONST.CLASSES.EXPANDED);
    ctrl.ctrl.classList.add(CONST.CLASSES.COLLAPSED);
    adjustPanelZIndex({ container: ctrl.ctrl, expanded: false });
  };

  updateSchemeBar(ctrl);
};

const setupObserver = (ctrl: HeatmapControlUI) => {
  ctrl.observer = new MutationObserver(() => {
    if (ctrl.ctrl.classList.contains(CONST.CLASSES.EXPANDED) && !ctrl.expandHookDone) {
      ctrl.expandHookDone = true;
      rebuildLayerDropdown(ctrl);
    }
    if (ctrl.ctrl.classList.contains(CONST.CLASSES.COLLAPSED)) {
      ctrl.expandHookDone = false;
    }
  });
  ctrl.observer.observe(ctrl.ctrl, { attributes: true });
};

const buildLayerListItems = (ctrl: HeatmapControlUI, sel: HTMLSelectElement) => {
  ctrl.mgr.scanMapLayers();
  sel.innerHTML = "";
  dom.el(
    "option",
    {
      value: "",
      disabled: true,
      class: CONST.CLASSES.PLACEHOLDER_OPTION,
      parent: sel,
      selected: !ctrl.mgr.selectedLayerId ? "" : undefined,
    },
    ctrl.T("layer_placeholder"),
  );

  ctrl.mgr.pointLayers.forEach(info => {
    dom.el("option", { value: info.id, parent: sel }, info.name);
  });

  // Auto-select a single point layer only on the very first scan, so the
  // initial map load shows its heatmap without user input.  Rebuilds
  // triggered later (zoomend, layeradd/layerremove, map reload) must not
  // re-fire this — otherwise a user's manual clear keeps being overridden.
  if (
    !ctrl.mgr.hasScanned &&
    ctrl.mgr.pointLayers.length === 1 &&
    !ctrl.mgr.selectedLayerId
  ) {
    ctrl.mgr.selectedLayerId = ctrl.mgr.pointLayers[0].id;
    if (ctrl.extraBody) ctrl.extraBody.classList.remove(CONST.CLASSES.HIDDEN);
    syncSelect(ctrl, sel, ctrl.mgr.selectedLayerId);
    updateFieldSelector(ctrl);
    ctrl.mgr.renderHexagons();
  } else if (ctrl.mgr.selectedLayerId) {
    // Restored selection (localStorage / rebuild): resolve the field list
    // first so autoFieldKey is fresh — syncSourceMeta reads it under currentField.
    updateFieldSelector(ctrl);
  }

  // Selection (auto, restored, or user) and field resolution are settled here —
  // publish source-layer / agg-field so the attrs panel is current without a
  // further user edit.
  ctrl.mgr.syncSourceMeta();

  if (ctrl.mgr.selectedLayerId) sel.value = ctrl.mgr.selectedLayerId;
  else sel.selectedIndex = 0;

  sel.onchange = () => {
    ctrl.mgr.selectedLayerId = sel.value || null;
    if (ctrl.extraBody) {
      ctrl.extraBody.classList.toggle(CONST.CLASSES.HIDDEN, !ctrl.mgr.selectedLayerId);
    }
    syncSelect(ctrl, sel, sel.value);
    updateFieldSelector(ctrl);
    if (ctrl.mgr.selectedLayerId) ctrl.mgr.renderHexagons();
    else ctrl.mgr.clearHeatmapCanvas();
    persist(ctrl);
  };

  syncSelect(ctrl, sel, sel.value);
  if (ctrl.extraBody) {
    ctrl.extraBody.classList.toggle(CONST.CLASSES.HIDDEN, !ctrl.mgr.selectedLayerId);
  }
};

const rebuildLayerDropdown = (ctrl: HeatmapControlUI) => {
  if (ctrl.layerSelect) buildLayerListItems(ctrl, ctrl.layerSelect);
};

const updateFieldSelector = (ctrl: HeatmapControlUI) => {
  if (!ctrl.fieldWrap || !ctrl.fieldSelect) return;
  if (ctrl.mgr.currentAgg === CONST.AGG.COUNT) {
    ctrl.fieldWrap.classList.add(CONST.CLASSES.HIDDEN);
    return;
  }
  ctrl.fieldWrap.classList.remove(CONST.CLASSES.HIDDEN);

  const selected = ctrl.mgr.pointLayers.filter(
    info => info.id === ctrl.mgr.selectedLayerId,
  );
  const fields = ctrl.mgr.collectFields(selected);
  ctrl.mgr.autoFieldKey = ctrl.mgr.pickAutoField(fields);

  ctrl.fieldSelect.innerHTML = "";
  dom.el(
    "option",
    {
      value: "",
      disabled: true,
      class: CONST.CLASSES.PLACEHOLDER_OPTION,
      parent: ctrl.fieldSelect,
    },
    ctrl.T("field_auto"),
  );

  fields.forEach(f => {
    dom.el("option", { value: f, parent: ctrl.fieldSelect }, f);
  });

  if (ctrl.mgr.currentField && !fields.includes(ctrl.mgr.currentField)) {
    ctrl.mgr.currentField = "";
  }
  ctrl.fieldSelect.value = ctrl.mgr.currentField;

  syncSelect(ctrl, ctrl.fieldSelect, ctrl.fieldSelect.value);
};

const renderColorBar = (
  ctrl: HeatmapControlUI,
  container: HTMLElement,
  name: string,
  numClasses: number,
) => {
  const colors = ctrl.mgr.getColorScale(name, numClasses);
  container.innerHTML = "";
  for (const color of colors) {
    dom.el("div", {
      class: CONST.CLASSES.SCHEME_BAR_BLOCK,
      style: `background:${color};width:${100 / colors.length}%`,
      parent: container,
    });
  }
};

const updateSchemeBar = (ctrl: HeatmapControlUI) => {
  renderColorBar(
    ctrl,
    ctrl.schemeBarInner,
    ctrl.mgr.currentScheme,
    ctrl.mgr.numClasses,
  );
  ctrl.schemeBar.title = ctrl.mgr.currentScheme;
};

const refreshSchemeDropdownItems = (ctrl: HeatmapControlUI) => {
  if (!ctrl.schemeDropdown) return;
  const items = ctrl.schemeDropdown.querySelectorAll(
    CONST.SEL.SCHEME_DROPDOWN_ITEM,
  ) as NodeListOf<HTMLElement>;
  items.forEach(item => {
    const name = item.getAttribute("data-scheme-name");
    if (!name) return;
    const bar = item.querySelector(CONST.SEL.SCHEME_DROPDOWN_BAR) as HTMLElement | null;
    if (bar) renderColorBar(ctrl, bar, name, ctrl.mgr.numClasses);
  });
};

const toggleSchemeDropdown = (ctrl: HeatmapControlUI) => {
  if (ctrl.schemeDropdown) {
    ctrl.schemeDropdown.remove();
    ctrl.schemeDropdown = null;
    ctrl.schemeBar.classList.remove(CONST.CLASSES.SCHEME_BAR_OPEN);
    return;
  }
  ctrl.schemeBar.classList.add(CONST.CLASSES.SCHEME_BAR_OPEN);
  ctrl.schemeDropdown = dom.el("div", {
    class: CONST.CLASSES.SCHEME_DROPDOWN,
    role: "listbox",
    parent: ctrl.schemeControlWrap,
  });

  let focusIdx = -1;
  (ctrl.config.schemes ?? []).forEach((name: string, idx: number) => {
    const item = dom.el("div", {
      class: CONST.CLASSES.SCHEME_DROPDOWN_ITEM,
      role: "option",
      tabindex: -1,
      "data-scheme-name": name,
      parent: ctrl.schemeDropdown,
    });
    if (name === ctrl.mgr.currentScheme) {
      item.classList.add(CONST.CLASSES.ACTIVE);
      focusIdx = idx;
    }

    const itemBar = dom.el("div", {
      class: CONST.CLASSES.SCHEME_DROPDOWN_BAR,
      parent: item,
    });
    renderColorBar(ctrl, itemBar, name, ctrl.mgr.numClasses);
    item.title = name;

    item.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      selectScheme(ctrl, name);
    };
  });

  const items = ctrl.schemeDropdown.querySelectorAll(
    CONST.SEL.SCHEME_DROPDOWN_ITEM,
  ) as NodeListOf<HTMLElement>;
  if (items.length) {
    if (focusIdx >= 0) items[focusIdx].focus();
    else items[0].focus();
  }

  ctrl.dropdownCleanup = registerDropdownEvents(ctrl.mgr.map, ctrl, Array.from(items));
};

const selectScheme = (ctrl: HeatmapControlUI, name: string) => {
  ctrl.mgr.currentScheme = name;
  ctrl.schemeSelectHidden.value = name;
  updateSchemeBar(ctrl);
  if (ctrl.schemeDropdown) {
    ctrl.schemeDropdown.remove();
    ctrl.schemeDropdown = null;
    ctrl.schemeBar.classList.remove(CONST.CLASSES.SCHEME_BAR_OPEN);
  }
  ctrl.mgr.renderHexagons();
  ctrl.schemeBar.focus();
  persist(ctrl);
};

/**
 * Scan the map for point layers. Driven by the ready signal instead of a
 * retry loop: an immediate first pass, a re-scan on every CONTROL_ATTACHED
 * (a control — usually LayerControl — finishing attach), and a final pass
 * one macrotask later to settle the "no point layers" hint — every control
 * attaches in the same synchronous script stack, so by then the layer set is
 * final (dynamic layer changes after that flow through LAYER_CHANGE in the
 * manager). Returns a cleanup that unsubscribes.
 */
const initScan = (ctrl: HeatmapControlUI): (() => void) => {
  let done = false;

  const scan = (final: boolean): void => {
    if (done) return;
    try {
      ctrl.mgr.scanMapLayers();
    } catch {
      // scanMapLayers may throw when LayerControl is missing (e.g.
      // map.foliplus.LayerAPI is the lightweight stub that lacks the
      // full registry methods). The error is harmless — we just
      // treat it as "no layers found" and continue to the hint logic.
    }
    if (ctrl.mgr.pointLayers.length > 0) {
      rebuildLayerDropdown(ctrl);
      // Mark scanned only after the first rebuild completes, so the
      // one-shot single-layer auto-select inside buildLayerListItems can
      // still fire for the initial map load but never again afterwards.
      ctrl.mgr.hasScanned = true;
      // Restore path: rebuild only syncs the dropdown value — refresh the
      // field selector and draw the saved layer so a reload shows the saved
      // configuration without waiting for user input.
      if (ctrl.mgr.selectedLayerId) {
        updateFieldSelector(ctrl);
        if (!ctrl.mgr.cachedFeatures) ctrl.mgr.renderHexagons();
      }
      ctrl.ctrl?.setAttribute("data-ready", "true");
      done = true;
      cleanup();
    } else if (final) {
      // Settle: no point layer showed up. Distinguish the two causes so the
      // hint points the user at the right fix: isLayerControl===false means
      // only the lightweight LayerAPI stub is installed (no LayerControl
      // added), whereas true means LayerControl is present but has no data.
      const missingLayerControl = !ctrl.mgr.map.foliplus?.LayerAPI?.isLayerControl;
      ctrl.mgr.map.foliplus!.showHint(
        ctrl.config.name,
        ctrl.T(missingLayerControl ? "no_layercontrol" : "no_layer"),
        HINT_DURATION.LONG,
      );
      ctrl.mgr.hasScanned = true;
      ctrl.ctrl?.setAttribute("data-ready", "true");
      done = true;
      cleanup();
    }
  };

  const events = ensureEvents(ctrl.mgr.map);
  const cleanup = events.on(EVENTS.CONTROL_ATTACHED, () => scan(false));

  // Settle after the synchronous attach sequence: a control that attached
  // before this subscription (e.g. LayerControl added before Heatmap) is
  // covered by the immediate pass below; the final pass here ends the
  // initial scan. No fixed delay — the attach stack is synchronous.
  setTimeout(() => scan(true), 0);

  scan(false);

  return () => {
    if (done) return;
    done = true;
    cleanup();
  };
};

/** Reset the panel to its initial state — manager state back to the declared
 *  defaults, canvas wiped, every dropdown on its placeholder. Shared by the
 *  panel's Clear button and the LAYER_DELETED path (LayerControl's more-menu
 *  clear) so clearing the heatmap reads the same way from either entry. */
const resetPanel = (ctrl: HeatmapControlUI) => {
  ctrl.mgr.resetState(ctrl.config);
  ctrl.mgr.clearHeatmapCanvas();
  // Read the reset values off the manager instead of recomputing the defaults —
  // resetState is the single source, and bindControls' initial clamp (see above)
  // is the one the class select needs.
  syncSelect(ctrl, ctrl.layerSelect, "");
  syncSelect(ctrl, ctrl.aggSelect, ctrl.mgr.currentAgg);
  syncSelect(
    ctrl,
    ctrl.classSelect,
    String(
      Math.min(
        CONST.CLASS_COUNT.MAX,
        Math.max(CONST.CLASS_COUNT.MIN, ctrl.mgr.numClasses),
      ),
    ),
  );
  syncSelect(ctrl, ctrl.methodSelect, ctrl.mgr.currentMethod);
  ctrl.schemeSelectHidden.value = ctrl.mgr.currentScheme;
  updateSchemeBar(ctrl);
  updateFieldSelector(ctrl);
  // Drop the published source rows — the canvas unregisters on clear, but the
  // shared meta object outlives it and would repopulate stale values on re-register.
  ctrl.mgr.syncSourceMeta();
  ctrl.extraBody.classList.add(CONST.CLASSES.HIDDEN);
};

const syncSelect = (ctrl: HeatmapControlUI, el: HTMLSelectElement, value: string) => {
  el.value = value;
  el.classList.toggle(CONST.CLASSES.CLASS_PLACEHOLDER, !value);
};

export {
  type HeatmapControlUI,
  bindControls,
  initScan,
  rebuildLayerDropdown,
  resetPanel,
  setupObserver,
};
