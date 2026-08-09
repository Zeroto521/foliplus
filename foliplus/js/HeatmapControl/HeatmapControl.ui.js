// HeatmapControl UI building — standalone functions.
// All internal refs use direct function calls instead of `this.`.
import { createTranslator } from "../shared/locale.js";
import * as CONST from "./HeatmapControl.const.js";

const foliplus = window.foliplus;
const _ = createTranslator(CONF);

/** Create a form-row with label + control-wrap. */
const createFormRow = (ctrl, parent, labelKey, rowClass = CONST.CLASSES.FORM_ROW) => {
  const row = foliplus.dom.el("div", { class: rowClass, parent });
  foliplus.dom.el(
    "label",
    { class: CONST.CLASSES.FORM_LABEL, parent: row },
    _(labelKey),
  );
  const wrap = foliplus.dom.el("div", {
    class: CONST.CLASSES.FORM_CONTROL,
    parent: row,
  });
  return { row, wrap };
};

/** Build the data section: layer select, aggregation method, field selector. */
const buildDataSection = (ctrl, panelContent) => {
  const configBody = foliplus.dom.el("div", {
    class: CONST.CLASSES.CONFIG_BODY,
    parent: panelContent,
  });
  foliplus.dom.el("div", {
    class: CONST.CLASSES.SECTION_HEADING,
    parent: configBody,
    innerHTML: _(`${CONF.name}.section_data`),
  });

  const { wrap: layerSelectWrap } = createFormRow(
    ctrl,
    configBody,
    `${CONF.name}.layer`,
  );
  ctrl.layerSelect = foliplus.dom.el("select", {
    class: CONST.CLASSES.FORM_SELECT,
    parent: layerSelectWrap,
  });

  ctrl.extraBody = foliplus.dom.el("div", {
    class: `${CONST.CLASSES.EXTRA_BODY} ${CONST.CLASSES.HIDDEN}`,
    parent: configBody,
  });

  // Aggregation method
  const { wrap: aggControlWrap } = createFormRow(
    ctrl,
    ctrl.extraBody,
    `${CONF.name}.agg_method`,
  );
  ctrl.aggSelect = foliplus.dom.el("select", {
    class: CONST.CLASSES.FORM_SELECT,
    parent: aggControlWrap,
    innerHTML: `
        <option value="${CONST.AGG.COUNT}">${_(`${CONF.name}.agg_count`)}</option>
        <option value="${CONST.AGG.SUM}">${_(`${CONF.name}.agg_sum`)}</option>
        <option value="${CONST.AGG.AVG}">${_(`${CONF.name}.agg_avg`)}</option>
        <option value="${CONST.AGG.MIN}">${_(`${CONF.name}.agg_min`)}</option>
        <option value="${CONST.AGG.MAX}">${_(`${CONF.name}.agg_max`)}</option>`,
    value: ctrl.m.currentAgg,
    onchange: () => {
      ctrl.m.currentAgg = ctrl.aggSelect.value;
      updateFieldSelector(ctrl);
      ctrl.m.renderHexagons();
    },
  });

  ctrl.fieldWrap = foliplus.dom.el("div", {
    class: `${CONST.CLASSES.FORM_ROW} ${CONST.CLASSES.FIELD} ${CONST.CLASSES.HIDDEN}`,
    parent: ctrl.extraBody,
  });
  foliplus.dom.el("label", {
    class: CONST.CLASSES.FORM_LABEL,
    parent: ctrl.fieldWrap,
    innerHTML: _(`${CONF.name}.field`),
  });
  const fieldControlWrap = foliplus.dom.el("div", {
    class: CONST.CLASSES.FORM_CONTROL,
    parent: ctrl.fieldWrap,
  });
  ctrl.fieldSelect = foliplus.dom.el("select", {
    class: CONST.CLASSES.FORM_SELECT,
    parent: fieldControlWrap,
    onchange: () => {
      ctrl.m.currentField = ctrl.fieldSelect.value;
      ctrl.m.fieldAuto = false;
      syncSelect(ctrl, ctrl.fieldSelect, ctrl.fieldSelect.value);
      ctrl.m.renderHexagons();
    },
  });

  // Initialize layer dropdown LAST after all select refs are created
  buildLayerListItems(ctrl, ctrl.layerSelect);
};

/** Build the style section: classification, color scheme, border, label toggle, action buttons. */
const buildStyleSection = (ctrl) => {
  foliplus.dom.el("div", {
    class: CONST.CLASSES.SECTION_HEADING,
    parent: ctrl.extraBody,
    innerHTML: _(`${CONF.name}.section_style`),
  });
  const styleSection = foliplus.dom.el("div", {
    class: CONST.CLASSES.SECTION_BLOCK,
    parent: ctrl.extraBody,
  });

  // Classification method / classes
  const classRow = foliplus.dom.el("div", {
    class: CONST.CLASSES.FORM_ROW,
    parent: styleSection,
  });
  foliplus.dom.el("label", {
    class: CONST.CLASSES.FORM_LABEL,
    parent: classRow,
    innerHTML: _(`${CONF.name}.class_method`),
  });
  const classControlWrap = foliplus.dom.el("div", {
    class: `${CONST.CLASSES.FORM_CONTROL} ${CONST.CLASSES.FORM_CONTROL_INLINE}`,
    parent: classRow,
  });
  ctrl.methodSelect = foliplus.dom.el("select", {
    class: CONST.CLASSES.FORM_SELECT,
    parent: classControlWrap,
    innerHTML: `
        <option value="jenks">${_(`${CONF.name}.jenks`)}</option>
        <option value="quantile">${_(`${CONF.name}.quantile`)}</option>
        <option value="equal">${_(`${CONF.name}.equal`)}</option>
        <option value="heads">${_(`${CONF.name}.heads`)}</option>`,
    value: ctrl.m.currentMethod,
    onchange: () => {
      ctrl.m.currentMethod = ctrl.methodSelect.value;
      ctrl.m.renderHexagons();
    },
  });

  ctrl.classSelect = foliplus.dom.el("select", {
    class: `${CONST.CLASSES.FORM_SELECT} ${CONST.CLASSES.CLASS_COUNT_SELECT}`,
    parent: classControlWrap,
    onchange: () => {
      ctrl.m.numClasses = Math.min(
        9,
        Math.max(2, parseInt(ctrl.classSelect.value, 10) || 6),
      );
      updateSchemeBar(ctrl);
      if (ctrl.schemeDropdown) refreshSchemeDropdownItems(ctrl);
      ctrl.m.renderHexagons();
    },
  });
  for (let ci = 2; ci <= 9; ci++)
    foliplus.dom.el("option", { value: ci, parent: ctrl.classSelect }, String(ci));
  ctrl.classSelect.value = Math.min(9, Math.max(2, ctrl.m.numClasses));

  // Color scheme
  const schemeRow = foliplus.dom.el("div", {
    class: CONST.CLASSES.FORM_ROW,
    parent: styleSection,
  });
  foliplus.dom.el("label", {
    class: CONST.CLASSES.FORM_LABEL,
    parent: schemeRow,
    innerHTML: _(`${CONF.name}.scheme`),
  });
  ctrl.schemeControlWrap = foliplus.dom.el("div", {
    class: CONST.CLASSES.FORM_CONTROL,
    parent: schemeRow,
  });
  ctrl.schemeBar = foliplus.dom.el("div", {
    class: CONST.CLASSES.SCHEME_BAR,
    tabindex: 0,
    role: "combobox",
    "aria-label": _(`${CONF.name}.scheme`),
    parent: ctrl.schemeControlWrap,
  });
  ctrl.schemeBarInner = foliplus.dom.el("div", {
    class: CONST.CLASSES.SCHEME_BAR_INNER,
    parent: ctrl.schemeBar,
  });
  ctrl.schemeSelectHidden = foliplus.dom.el("select", {
    class: CONST.CLASSES.SCHEME_SELECT_HIDDEN,
    parent: ctrl.schemeControlWrap,
    onchange: () => {
      ctrl.m.currentScheme = ctrl.schemeSelectHidden.value;
      updateSchemeBar(ctrl);
      ctrl.m.renderHexagons();
    },
  });
  CONF.schemes.forEach((name) => {
    foliplus.dom.el("option", { value: name, parent: ctrl.schemeSelectHidden }, name);
  });
  ctrl.schemeSelectHidden.value = ctrl.m.currentScheme;
  updateSchemeBar(ctrl);

  ctrl.schemeBar.onclick = (e) => {
    e.stopPropagation();
    toggleSchemeDropdown(ctrl);
  };
  ctrl.schemeBar.onkeydown = (e) => {
    if (["Enter", " ", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      toggleSchemeDropdown(ctrl);
    }
  };

  // Close scheme dropdown when clicking outside
  ctrl.closeSchemeDropdown = (e) => {
    if (
      ctrl.schemeDropdown &&
      !ctrl.schemeBar.contains(e.target) &&
      !ctrl.schemeDropdown.contains(e.target)
    ) {
      ctrl.schemeDropdown.remove();
      ctrl.schemeDropdown = null;
      ctrl.schemeBar.classList.remove(CONST.CLASSES.SCHEME_BAR_OPEN);
      document.removeEventListener("click", ctrl.closeSchemeDropdown);
    }
  };
  const origToggle = () => toggleSchemeDropdown(ctrl);
  ctrl.toggleSchemeDropdown = () => {
    origToggle();
    if (ctrl.schemeDropdown)
      document.addEventListener("click", ctrl.closeSchemeDropdown);
  };

  // Border settings
  const borderRow = foliplus.dom.el("div", {
    class: CONST.CLASSES.FORM_ROW,
    parent: styleSection,
  });
  foliplus.dom.el("label", {
    class: CONST.CLASSES.FORM_LABEL,
    parent: borderRow,
    innerHTML: _(`${CONF.name}.border`),
  });
  const borderControlWrap = foliplus.dom.el("div", {
    class: `${CONST.CLASSES.FORM_CONTROL} ${CONST.CLASSES.FORM_CONTROL_INLINE}`,
    parent: borderRow,
  });
  ctrl.borderColorInput = foliplus.dom.el("input", {
    class: CONST.CLASSES.BORDER_COLOR_INPUT,
    type: "color",
    parent: borderControlWrap,
    value: ctrl.m.borderColor,
    oninput: () => {
      ctrl.m.borderColor = ctrl.borderColorInput.value;
      ctrl.m.renderHexagons();
    },
  });
  ctrl.borderWeightInput = foliplus.dom.el("input", {
    class: CONST.CLASSES.BORDER_WEIGHT_INPUT,
    type: "number",
    min: 0,
    max: 10,
    step: 0.5,
    parent: borderControlWrap,
    value: ctrl.m.borderWeight,
    oninput: () => {
      const v = parseFloat(ctrl.borderWeightInput.value);
      if (!isNaN(v) && v >= 0 && v <= 10) {
        ctrl.m.borderWeight = v;
        ctrl.m.renderHexagons();
      }
    },
    onchange: () => {
      const v = parseFloat(ctrl.borderWeightInput.value);
      ctrl.m.borderWeight = isNaN(v) ? 1 : Math.min(10, Math.max(0, v));
      ctrl.borderWeightInput.value = ctrl.m.borderWeight;
      ctrl.m.renderHexagons();
    },
  });

  // Label toggle
  const labelRow = foliplus.dom.el("div", {
    class: `${CONST.CLASSES.FORM_ROW} ${CONST.CLASSES.SECTION_BLOCK_LAST}`,
    parent: styleSection,
  });
  foliplus.dom.el("label", {
    class: CONST.CLASSES.FORM_LABEL,
    parent: labelRow,
    innerHTML: _(`${CONF.name}.label`),
  });
  const labelControlWrap = foliplus.dom.el("div", {
    class: CONST.CLASSES.FORM_CONTROL,
    parent: labelRow,
  });
  const labelToggle = foliplus.dom.el("label", {
    class: CONST.CLASSES.TOGGLE_SWITCH,
    parent: labelControlWrap,
  });
  ctrl.labelChk = foliplus.dom.el("input", {
    type: "checkbox",
    parent: labelToggle,
    checked: ctrl.m.currentLabelShow,
    onchange: () => {
      ctrl.m.currentLabelShow = ctrl.labelChk.checked;
      ctrl.m.renderHexagons();
    },
  });
  foliplus.dom.el("span", {
    class: CONST.CLASSES.TOGGLE_SLIDER,
    parent: labelToggle,
  });
  foliplus.dom.el("hr", {
    class: CONST.CLASSES.SECTION_DIVIDER,
    parent: ctrl.extraBody,
  });

  // Bottom action buttons
  const btnRow = foliplus.dom.el("div", {
    class: CONST.CLASSES.BTN_ROW,
    parent: ctrl.extraBody,
  });
  foliplus.dom.el("button", {
    class: `${CONST.CLASSES.BTN} ${CONST.CLASSES.BTN_CLEAR}`,
    parent: btnRow,
    innerHTML: _(`${CONF.name}.clear`),
    onclick: () => {
      resetAll(ctrl);
      syncSelect(ctrl, ctrl.layerSelect, "");
      syncSelect(ctrl, ctrl.aggSelect, CONST.AGG.COUNT);
      syncSelect(ctrl, ctrl.classSelect, String(CONF.n_classes));
      syncSelect(ctrl, ctrl.methodSelect, CONF.method);
      ctrl.schemeSelectHidden.value = CONF.color_scheme;
      ctrl.labelChk.checked = CONF.label_show;
      ctrl.borderWeightInput.value = CONF.border_weight;
      ctrl.borderColorInput.value = CONF.border_color;
      updateSchemeBar(ctrl);
      updateFieldSelector(ctrl);
      ctrl.extraBody.classList.add(CONST.CLASSES.HIDDEN);
      ctrl.container.classList.remove(CONST.CLASSES.EXPANDED);
      ctrl.container.classList.add(CONST.CLASSES.COLLAPSED);
      foliplus.adjustPanelZIndex({ container: ctrl.container, expanded: false });
    },
  });
  foliplus.dom.el("button", {
    class: `${CONST.CLASSES.BTN} ${CONST.CLASSES.BTN_CONFIRM}`,
    parent: btnRow,
    innerHTML: _(`${CONF.name}.confirm`),
    onclick: () => {
      ctrl.m.renderHexagons();
      ctrl.container.classList.remove(CONST.CLASSES.EXPANDED);
      ctrl.container.classList.add(CONST.CLASSES.COLLAPSED);
      foliplus.adjustPanelZIndex({ container: ctrl.container, expanded: false });
    },
  });
};

/** Set up MutationObserver to refresh layer dropdown on panel expand. */
const setupObserver = (ctrl) => {
  ctrl.observer = new MutationObserver(() => {
    if (
      ctrl.container.classList.contains(CONST.CLASSES.EXPANDED) &&
      !ctrl.expandHookDone
    ) {
      ctrl.expandHookDone = true;
      rebuildLayerDropdown(ctrl);
    }
    if (ctrl.container.classList.contains(CONST.CLASSES.COLLAPSED))
      ctrl.expandHookDone = false;
  });
  ctrl.observer.observe(ctrl.container, { attributes: true });
};

const buildLayerListItems = (ctrl, sel) => {
  ctrl.m.scanMapLayers();
  sel.innerHTML = "";
  const placeholder = foliplus.dom.el(
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

  ctrl.m.pointLayers.forEach((info) => {
    foliplus.dom.el("option", { value: info.id, parent: sel }, info.name);
  });

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
};

const rebuildLayerDropdown = (ctrl) => {
  if (ctrl.layerSelect) buildLayerListItems(ctrl, ctrl.layerSelect);
};

const updateFieldSelector = (ctrl) => {
  if (!ctrl.fieldWrap || !ctrl.fieldSelect) return;
  if (ctrl.m.currentAgg === CONST.AGG.COUNT) {
    ctrl.fieldWrap.classList.add(CONST.CLASSES.HIDDEN);
    return;
  }
  ctrl.fieldWrap.classList.remove(CONST.CLASSES.HIDDEN);

  const selected = ctrl.m.pointLayers.filter(
    (info) => info.id === ctrl.m.selectedLayerId,
  );
  const fields = ctrl.m.collectFields(selected);
  ctrl.m.autoFieldKey = ctrl.m.pickAutoField(fields);

  ctrl.fieldSelect.innerHTML = "";
  foliplus.dom.el(
    "option",
    {
      value: "",
      disabled: true,
      class: CONST.CLASSES.PLACEHOLDER_OPTION,
      parent: ctrl.fieldSelect,
    },
    _(`${CONF.name}.field_auto`),
  );

  fields.forEach((f) => {
    foliplus.dom.el(
      "option",
      { value: f, parent: ctrl.fieldSelect },
      f.startsWith("properties.") ? f.substring(11) : f,
    );
  });

  ctrl.m.fieldAuto = !fields.includes(ctrl.m.currentField);
  ctrl.fieldSelect.value = ctrl.m.fieldAuto ? "" : ctrl.m.currentField;

  syncSelect(ctrl, ctrl.fieldSelect, ctrl.fieldSelect.value);
};

/** Render color blocks into a container. */
const renderColorBar = (ctrl, container, name, nClasses) => {
  const colors = ctrl.m.getColorScale(name, nClasses);
  container.innerHTML = "";
  for (const color of colors) {
    foliplus.dom.el("div", {
      class: CONST.CLASSES.SCHEME_BAR_BLOCK,
      style: `background:${color};width:${100 / colors.length}%`,
      parent: container,
    });
  }
};

const updateSchemeBar = (ctrl) => {
  renderColorBar(ctrl, ctrl.schemeBarInner, ctrl.m.currentScheme, ctrl.m.numClasses);
  ctrl.schemeBar.title = ctrl.m.currentScheme;
};

const refreshSchemeDropdownItems = (ctrl) => {
  if (!ctrl.schemeDropdown) return;
  const items = ctrl.schemeDropdown.querySelectorAll(CONST.SEL.SCHEME_DROPDOWN_ITEM);
  items.forEach((item) => {
    const name = item.getAttribute("data-scheme-name");
    if (!name) return;
    const bar = item.querySelector(CONST.SEL.SCHEME_DROPDOWN_BAR);
    if (bar) renderColorBar(ctrl, bar, name, ctrl.m.numClasses);
  });
};

const toggleSchemeDropdown = (ctrl) => {
  if (ctrl.schemeDropdown) {
    ctrl.schemeDropdown.remove();
    ctrl.schemeDropdown = null;
    ctrl.schemeBar.classList.remove(CONST.CLASSES.SCHEME_BAR_OPEN);
    return;
  }
  ctrl.schemeBar.classList.add(CONST.CLASSES.SCHEME_BAR_OPEN);
  ctrl.schemeDropdown = foliplus.dom.el("div", {
    class: CONST.CLASSES.SCHEME_DROPDOWN,
    role: "listbox",
    parent: ctrl.schemeControlWrap,
  });

  let focusIdx = -1;
  CONF.schemes.forEach((name, idx) => {
    const item = foliplus.dom.el("div", {
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

    const itemBar = foliplus.dom.el("div", {
      class: CONST.CLASSES.SCHEME_DROPDOWN_BAR,
      parent: item,
    });
    renderColorBar(ctrl, itemBar, name, ctrl.m.numClasses);
    item.title = name;

    item.onclick = (ev) => {
      ev.stopPropagation();
      selectScheme(ctrl, name);
    };
  });

  const items = ctrl.schemeDropdown.querySelectorAll(CONST.SEL.SCHEME_DROPDOWN_ITEM);
  if (items.length) {
    if (focusIdx >= 0) items[focusIdx].focus();
    else items[0].focus();
  }

  ctrl.schemeDropdown.onkeydown = (e) => {
    const activeIdx = Array.from(items).indexOf(document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(activeIdx + 1) % items.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(activeIdx - 1 + items.length) % items.length].focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const active = document.activeElement;
      if (active?.classList.contains(CONST.CLASSES.SCHEME_DROPDOWN_ITEM)) {
        const idx = Array.from(items).indexOf(active);
        selectScheme(ctrl, CONF.schemes[idx]);
      }
    } else if (e.key === "Escape") {
      ctrl.schemeDropdown.remove();
      ctrl.schemeDropdown = null;
      ctrl.schemeBar.classList.remove(CONST.CLASSES.SCHEME_BAR_OPEN);
      ctrl.schemeBar.focus();
    }
  };
};

const selectScheme = (ctrl, name) => {
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

const initScan = (ctrl, attempt) => {
  ctrl.m.scanMapLayers();
  if (ctrl.m.pointLayers.length === 0 && attempt > 0)
    setTimeout(() => initScan(ctrl, attempt - 1), CONST.TIMING.INIT_SCAN_INTERVAL);
  else if (ctrl.m.pointLayers.length === 0)
    foliplus.showHint(
      CONF.name,
      _(`${CONF.name}.no_layer`),
      foliplus.HINT_DURATION.LONG,
    );
  else rebuildLayerDropdown(ctrl);
};

const resetAll = (ctrl) => {
  ctrl.m.selectedLayerId = null;
  ctrl.m.autoFieldKey = null;
  ctrl.m.fieldAuto = true;
  ctrl.m.currentAgg = CONST.AGG.COUNT;
  ctrl.m.currentField = CONF.field;
  ctrl.m.numClasses = CONF.n_classes;
  ctrl.m.currentMethod = CONF.method;
  ctrl.m.currentScheme = CONF.color_scheme;
  ctrl.m.currentLabelShow = CONF.label_show;
  ctrl.m.borderWeight = CONF.border_weight;
  ctrl.m.borderColor = CONF.border_color;
  ctrl.m.clearHeatmapCanvas();
};

const syncSelect = (ctrl, el, value) => {
  el.value = value;
  el.classList.toggle(CONST.CLASSES.CLASS_PLACEHOLDER, !value);
};

export {
  buildDataSection,
  buildLayerListItems,
  buildStyleSection,
  createFormRow,
  initScan,
  rebuildLayerDropdown,
  refreshSchemeDropdownItems,
  renderColorBar,
  resetAll,
  selectScheme,
  setupObserver,
  syncSelect,
  toggleSchemeDropdown,
  updateFieldSelector,
  updateSchemeBar,
};
