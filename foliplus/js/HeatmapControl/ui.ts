// HeatmapControl UI building — standalone functions.
// All internal refs use direct function calls instead of `this.`.
import { HINT_DURATION } from "#core/hint.js";
import { ensureKeyboard } from "#core/keyboard.js";
import { dom } from "#common/dom.js";
import { createTranslator } from "#common/locale.js";
import { adjustPanelZIndex } from "#common/panel.js";
import * as CONST from "./const.js";
import { HeatmapManager } from "./manager.js";
import { panelContentHTML } from "./template.js";

const _ = createTranslator(CONF);

/** Shape of the HeatmapControl instance as consumed by UI functions. */
export interface HeatmapControlUI {
  m: HeatmapManager;
  ctrl: HTMLElement;
  schemeDropdown: HTMLElement | null;
  expandHookDone: boolean;
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
  borderColorInput: HTMLInputElement;
  borderWeightInput: HTMLInputElement;
  labelChk: HTMLInputElement;
  closeSchemeDropdown: (event: MouseEvent) => void;
  toggleSchemeDropdown: () => void;
}

const bindControls = (ctrl: HeatmapControlUI, panelContent: HTMLElement) => {
  panelContent.innerHTML = panelContentHTML(_);

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
  ctrl.borderColorInput = panelContent.querySelector(
    `[${CONST.DATA_ATTR.BORDER_COLOR}]`,
  ) as HTMLInputElement;
  ctrl.borderWeightInput = panelContent.querySelector(
    `[${CONST.DATA_ATTR.BORDER_WEIGHT}]`,
  ) as HTMLInputElement;
  ctrl.labelChk = panelContent.querySelector(
    `[${CONST.DATA_ATTR.LABEL_CHK}]`,
  ) as HTMLInputElement;

  // Set initial values from manager defaults
  ctrl.borderColorInput.value = ctrl.m.borderColor;
  ctrl.borderWeightInput.value = String(ctrl.m.borderWeight);
  ctrl.labelChk.checked = ctrl.m.currentLabelShow;
  ctrl.classSelect.value = String(
    Math.min(CONST.CLASS_COUNT.MAX, Math.max(CONST.CLASS_COUNT.MIN, ctrl.m.numClasses)),
  );
  ctrl.methodSelect.value = ctrl.m.currentMethod;
  ctrl.aggSelect.value = ctrl.m.currentAgg;

  // Populate scheme options and set current value
  (CONF.schemes ?? []).forEach(name => {
    dom.el("option", { value: name, parent: ctrl.schemeSelectHidden }, name);
  });
  ctrl.schemeSelectHidden.value = ctrl.m.currentScheme;

  ctrl.aggSelect.onchange = () => {
    ctrl.m.currentAgg = ctrl.aggSelect.value;
    updateFieldSelector(ctrl);
    ctrl.m.renderHexagons();
  };

  ctrl.fieldSelect.onchange = () => {
    ctrl.m.currentField = ctrl.fieldSelect.value;
    ctrl.m.fieldAuto = false;
    syncSelect(ctrl, ctrl.fieldSelect, ctrl.fieldSelect.value);
    ctrl.m.renderHexagons();
  };

  ctrl.methodSelect.onchange = () => {
    ctrl.m.currentMethod = ctrl.methodSelect.value;
    ctrl.m.renderHexagons();
  };

  ctrl.classSelect.onchange = () => {
    ctrl.m.numClasses = Math.min(
      CONST.CLASS_COUNT.MAX,
      Math.max(
        CONST.CLASS_COUNT.MIN,
        parseInt(ctrl.classSelect.value, 10) || CONST.CLASS_COUNT.DEFAULT,
      ),
    );
    updateSchemeBar(ctrl);
    if (ctrl.schemeDropdown) refreshSchemeDropdownItems(ctrl);
    ctrl.m.renderHexagons();
  };

  ctrl.schemeBar.onclick = event => {
    event.stopPropagation();
    toggleSchemeDropdown(ctrl);
  };
  ensureKeyboard(map).register(CONF.name, [
    {
      key: "ArrowLeft",
      element: ctrl.schemeBar,
      handler: () => {
        const c = ctrl as any;
        const idx = c.availableSchemes.indexOf(c.scheme);
        if (idx > 0) {
          c.scheme = c.availableSchemes[idx - 1];
          c.updateScheme();
        }
      },
    },
    {
      key: "ArrowRight",
      element: ctrl.schemeBar,
      handler: () => {
        const c = ctrl as any;
        const idx = c.availableSchemes.indexOf(c.scheme);
        if (idx < c.availableSchemes.length - 1) {
          c.scheme = c.availableSchemes[idx + 1];
          c.updateScheme();
        }
      },
    },
  ]);
  ensureKeyboard(map).register(CONF.name, [
    { key: "Enter", element: ctrl.schemeBar, handler: () => { toggleSchemeDropdown(ctrl); } },
    { key: " ", element: ctrl.schemeBar, handler: () => { toggleSchemeDropdown(ctrl); } },
    { key: "ArrowUp", element: ctrl.schemeBar, handler: () => { toggleSchemeDropdown(ctrl); } },
    { key: "ArrowDown", element: ctrl.schemeBar, handler: () => { toggleSchemeDropdown(ctrl); } },
  ]);

  ctrl.schemeSelectHidden.onchange = () => {
    ctrl.m.currentScheme = ctrl.schemeSelectHidden.value;
    updateSchemeBar(ctrl);
    ctrl.m.renderHexagons();
  };

  ctrl.borderColorInput.oninput = () => {
    ctrl.m.borderColor = ctrl.borderColorInput.value;
    ctrl.m.renderHexagons();
  };

  ctrl.borderWeightInput.oninput = () => {
    const v = parseFloat(ctrl.borderWeightInput.value);
    if (!isNaN(v) && v >= CONST.BORDER.WEIGHT_MIN && v <= CONST.BORDER.WEIGHT_MAX) {
      ctrl.m.borderWeight = v;
      ctrl.m.renderHexagons();
    }
  };
  ctrl.borderWeightInput.onchange = () => {
    const v = parseFloat(ctrl.borderWeightInput.value);
    ctrl.m.borderWeight = isNaN(v)
      ? CONST.BORDER.WEIGHT_DEFAULT
      : Math.min(CONST.BORDER.WEIGHT_MAX, Math.max(CONST.BORDER.WEIGHT_MIN, v));
    ctrl.borderWeightInput.value = String(ctrl.m.borderWeight);
    ctrl.m.renderHexagons();
  };

  ctrl.labelChk.onchange = () => {
    ctrl.m.currentLabelShow = ctrl.labelChk.checked;
    ctrl.m.renderHexagons();
  };

  ctrl.closeSchemeDropdown = (event: MouseEvent) => {
    if (
      ctrl.schemeDropdown &&
      !ctrl.schemeBar.contains(event.target as Node) &&
      !ctrl.schemeDropdown.contains(event.target as Node)
    ) {
      ctrl.schemeDropdown.remove();
      ctrl.schemeDropdown = null;
      ctrl.schemeBar.classList.remove(CONST.CLASSES.SCHEME_BAR_OPEN);
      document.removeEventListener("click", ctrl.closeSchemeDropdown);
    }
  };
  ctrl.toggleSchemeDropdown = () => {
    toggleSchemeDropdown(ctrl);
    if (ctrl.schemeDropdown)
      document.addEventListener("click", ctrl.closeSchemeDropdown);
  };

  const clearBtn = panelContent.querySelector(
    `[${CONST.DATA_ATTR.BTN_CLEAR}]`,
  ) as HTMLButtonElement;
  clearBtn.onclick = () => {
    resetAll(ctrl);
    syncSelect(ctrl, ctrl.layerSelect, "");
    syncSelect(ctrl, ctrl.aggSelect, CONST.AGG.COUNT);
    syncSelect(
      ctrl,
      ctrl.classSelect,
      String(CONF.n_classes ?? CONST.CLASS_COUNT.DEFAULT),
    );
    syncSelect(ctrl, ctrl.methodSelect, CONF.method ?? CONST.METHOD.JENKS);
    ctrl.schemeSelectHidden.value = CONF.color_scheme ?? "Reds";
    ctrl.labelChk.checked = CONF.label_show ?? false;
    ctrl.borderWeightInput.value = String(
      CONF.border_weight ?? CONST.BORDER.WEIGHT_DEFAULT,
    );
    ctrl.borderColorInput.value = CONF.border_color ?? CONST.GRAY;
    updateSchemeBar(ctrl);
    updateFieldSelector(ctrl);
    ctrl.extraBody.classList.add(CONST.CLASSES.HIDDEN);
    ctrl.ctrl.classList.remove(CONST.CLASSES.EXPANDED);
    ctrl.ctrl.classList.add(CONST.CLASSES.COLLAPSED);
    adjustPanelZIndex({ container: ctrl.ctrl, expanded: false });
  };

  const confirmBtn = panelContent.querySelector(
    `[${CONST.DATA_ATTR.BTN_CONFIRM}]`,
  ) as HTMLButtonElement;
  confirmBtn.onclick = () => {
    ctrl.m.renderHexagons();
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
    if (ctrl.ctrl.classList.contains(CONST.CLASSES.COLLAPSED))
      ctrl.expandHookDone = false;
  });
  ctrl.observer.observe(ctrl.ctrl, { attributes: true });
};

const buildLayerListItems = (ctrl: HeatmapControlUI, sel: HTMLSelectElement) => {
  ctrl.m.scanMapLayers();
  sel.innerHTML = "";
  dom.el(
    "option",
    {
      value: "",
      disabled: true,
      class: CONST.CLASSES.PLACEHOLDER_OPTION,
      parent: sel,
      selected: !ctrl.m.selectedLayerId ? "" : undefined,
    },
    _(`${CONF.name}.layer_placeholder`),
  );

  ctrl.m.pointLayers.forEach(info => {
    dom.el("option", { value: info.id, parent: sel }, info.name);
  });

  if (ctrl.m.pointLayers.length === 1 && !ctrl.m.selectedLayerId) {
    ctrl.m.selectedLayerId = ctrl.m.pointLayers[0].id;
    if (ctrl.extraBody) ctrl.extraBody.classList.remove(CONST.CLASSES.HIDDEN);
    syncSelect(ctrl, sel, ctrl.m.selectedLayerId);
    updateFieldSelector(ctrl);
    ctrl.m.renderHexagons();
  }

  if (ctrl.m.selectedLayerId) sel.value = ctrl.m.selectedLayerId;
  else sel.selectedIndex = 0;

  sel.onchange = () => {
    ctrl.m.selectedLayerId = sel.value || null;
    if (ctrl.extraBody)
      ctrl.extraBody.classList.toggle(CONST.CLASSES.HIDDEN, !ctrl.m.selectedLayerId);
    syncSelect(ctrl, sel, sel.value);
    updateFieldSelector(ctrl);
    if (ctrl.m.selectedLayerId) ctrl.m.renderHexagons();
    else ctrl.m.clearHeatmapCanvas();
  };

  syncSelect(ctrl, sel, sel.value);
  if (ctrl.extraBody)
    ctrl.extraBody.classList.toggle(CONST.CLASSES.HIDDEN, !ctrl.m.selectedLayerId);
};

const rebuildLayerDropdown = (ctrl: HeatmapControlUI) => {
  if (ctrl.layerSelect) buildLayerListItems(ctrl, ctrl.layerSelect);
};

const updateFieldSelector = (ctrl: HeatmapControlUI) => {
  if (!ctrl.fieldWrap || !ctrl.fieldSelect) return;
  if (ctrl.m.currentAgg === CONST.AGG.COUNT) {
    ctrl.fieldWrap.classList.add(CONST.CLASSES.HIDDEN);
    return;
  }
  ctrl.fieldWrap.classList.remove(CONST.CLASSES.HIDDEN);

  const selected = ctrl.m.pointLayers.filter(
    info => info.id === ctrl.m.selectedLayerId,
  );
  const fields = ctrl.m.collectFields(selected);
  ctrl.m.autoFieldKey = ctrl.m.pickAutoField(fields);

  ctrl.fieldSelect.innerHTML = "";
  dom.el(
    "option",
    {
      value: "",
      disabled: true,
      class: CONST.CLASSES.PLACEHOLDER_OPTION,
      parent: ctrl.fieldSelect,
    },
    _(`${CONF.name}.field_auto`),
  );

  fields.forEach(f => {
    dom.el(
      "option",
      { value: f, parent: ctrl.fieldSelect },
      f.startsWith("properties.") ? f.substring(11) : f,
    );
  });

  ctrl.m.fieldAuto = !fields.includes(ctrl.m.currentField);
  ctrl.fieldSelect.value = ctrl.m.fieldAuto ? "" : ctrl.m.currentField;

  syncSelect(ctrl, ctrl.fieldSelect, ctrl.fieldSelect.value);
};

const renderColorBar = (
  ctrl: HeatmapControlUI,
  container: HTMLElement,
  name: string,
  nClasses: number,
) => {
  const colors = ctrl.m.getColorScale(name, nClasses);
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
  renderColorBar(ctrl, ctrl.schemeBarInner, ctrl.m.currentScheme, ctrl.m.numClasses);
  ctrl.schemeBar.title = ctrl.m.currentScheme;
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
    if (bar) renderColorBar(ctrl, bar, name, ctrl.m.numClasses);
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
  (CONF.schemes ?? []).forEach((name: string, idx: number) => {
    const item = dom.el("div", {
      class: CONST.CLASSES.SCHEME_DROPDOWN_ITEM,
      role: "option",
      tabindex: -1,
      "data-scheme-name": name,
      parent: ctrl.schemeDropdown,
    });
    if (name === ctrl.m.currentScheme) {
      item.classList.add(CONST.CLASSES.ACTIVE);
      focusIdx = idx;
    }

    const itemBar = dom.el("div", {
      class: CONST.CLASSES.SCHEME_DROPDOWN_BAR,
      parent: item,
    });
    renderColorBar(ctrl, itemBar, name, ctrl.m.numClasses);
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

  ensureKeyboard(map).register(CONF.name, [
    { key: "ArrowDown", element: ctrl.schemeDropdown, handler: () => {
      const activeIdx = Array.from(items).indexOf(document.activeElement as HTMLElement);
      items[(activeIdx + 1) % items.length].focus();
    }},
    { key: "ArrowUp", element: ctrl.schemeDropdown, handler: () => {
      const activeIdx = Array.from(items).indexOf(document.activeElement as HTMLElement);
      items[(activeIdx - 1 + items.length) % items.length].focus();
    }},
    { key: "Enter", element: ctrl.schemeDropdown, handler: () => {
      const active = document.activeElement;
      if (active?.classList.contains(CONST.CLASSES.SCHEME_DROPDOWN_ITEM)) {
        const idx = Array.from(items).indexOf(active as HTMLElement);
        selectScheme(ctrl, (CONF.schemes ?? [])[idx]);
      }
    }},
    { key: "Escape", element: ctrl.schemeDropdown, handler: () => {
      ctrl.schemeDropdown?.remove();
      ctrl.schemeDropdown = null;
      ctrl.schemeBar.classList.remove(CONST.CLASSES.SCHEME_BAR_OPEN);
      ctrl.schemeBar.focus();
    }},
  ]);
};

const selectScheme = (ctrl: HeatmapControlUI, name: string) => {
  ctrl.m.currentScheme = name;
  ctrl.schemeSelectHidden.value = name;
  updateSchemeBar(ctrl);
  if (ctrl.schemeDropdown) {
    ctrl.schemeDropdown.remove();
    ctrl.schemeDropdown = null;
    ctrl.schemeBar.classList.remove(CONST.CLASSES.SCHEME_BAR_OPEN);
  }
  ctrl.m.renderHexagons();
  ctrl.schemeBar.focus();
};

const initScan = (ctrl: HeatmapControlUI, attempt: number) => {
  ctrl.m.scanMapLayers();
  if (ctrl.m.pointLayers.length === 0 && attempt > 0)
    setTimeout(() => initScan(ctrl, attempt - 1), CONST.TIMING.INIT_SCAN_INTERVAL);
  else if (ctrl.m.pointLayers.length === 0)
    map.foliplus!.showHint(CONF.name, _(`${CONF.name}.no_layer`), HINT_DURATION.LONG);
  else rebuildLayerDropdown(ctrl);
};

const resetAll = (ctrl: HeatmapControlUI) => {
  ctrl.m.selectedLayerId = null;
  ctrl.m.autoFieldKey = null;
  ctrl.m.fieldAuto = true;
  ctrl.m.currentAgg = CONST.AGG.COUNT;
  ctrl.m.currentField = CONF.field ?? "";
  ctrl.m.numClasses = CONF.n_classes ?? CONST.CLASS_COUNT.DEFAULT;
  ctrl.m.currentMethod = CONF.method ?? CONST.METHOD.JENKS;
  ctrl.m.currentScheme = CONF.color_scheme ?? "Reds";
  ctrl.m.currentLabelShow = CONF.label_show ?? false;
  ctrl.m.borderWeight = CONF.border_weight ?? CONST.BORDER.WEIGHT_DEFAULT;
  ctrl.m.borderColor = CONF.border_color ?? CONST.GRAY;
  ctrl.m.clearHeatmapCanvas();
};

const syncSelect = (ctrl: HeatmapControlUI, el: HTMLSelectElement, value: string) => {
  el.value = value;
  el.classList.toggle(CONST.CLASSES.CLASS_PLACEHOLDER, !value);
};

export { bindControls, initScan, rebuildLayerDropdown, setupObserver };
