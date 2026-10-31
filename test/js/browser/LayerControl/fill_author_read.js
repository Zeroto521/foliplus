// Read the fill row's original-colors arm: the read-only detail (column,
// ordered colors, count), the controls that must NOT be there, and the fill
// colors actually painted on the map.
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const select = panel?.querySelector(".foliplus-style-fill-mode-select");
  const option = select?.querySelector('option[value="original"]');
  const detail = panel?.querySelector(".foliplus-style-fill-detail");
  const box = name => panel?.querySelector(`.${name}`);
  const strip = box("foliplus-style-fill-original-strip");
  const colors = box("foliplus-style-fill-original-colors");
  const columnBox = box("foliplus-style-fill-original-column");
  const countBox = box("foliplus-style-fill-original-count");
  const methodBox = box("foliplus-style-fill-original-method");
  const readout = el => {
    const value = el?.querySelector(".foliplus-style-fill-original-value");
    return value ? value.textContent : null;
  };
  const geom = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      width: Math.round(r.width),
    };
  };
  const gradient = strip ? strip.style.background : "";
  const fills = [
    ...new Set(
      [...document.querySelectorAll("path.leaflet-interactive")]
        .map(p => p.getAttribute("fill"))
        .filter(Boolean),
    ),
  ].sort();
  const panelRect = panel ? panel.getBoundingClientRect() : null;
  const widest = [
    ...(panel?.querySelectorAll(".foliplus-style-fill-readonly") ?? []),
  ].map(el => Math.round(el.getBoundingClientRect().right));
  return {
    mode: select ? select.value : null,
    originalAvailable: !!option,
    originalDisabled: option ? option.disabled : null,
    originalLabel: option ? option.textContent : null,
    note: select ? select.title : null,
    column: readout(columnBox),
    count: readout(countBox),
    method: readout(methodBox),
    caption: colors ? colors.title : null,
    // Geometry: the method readout spans the control column (left/right/width
    // equal to the colors box), the count readout hugs the right edge at the
    // compact secondary width. The value's textAlign distinguishes the spanning
    // method readout (left) from the centered count value.
    methodGeom: geom(methodBox),
    countGeom: geom(countBox),
    colorsGeom: geom(colors),
    methodTextAlign: methodBox
      ? methodBox.querySelector(".foliplus-style-fill-original-value")?.style.textAlign
      : null,
    countTextAlign: countBox
      ? countBox.querySelector(".foliplus-style-fill-original-value")?.style.textAlign
      : null,
    colorsLabel: colors ? colors.getAttribute("aria-label") : null,
    gradient,
    // Every stop of a linear-gradient names two positions, so halving the
    // percentage count is the stop count the browser received.
    stops: (gradient.match(/%/g) ?? []).length / 2,
    // Anything interactive inside the read-only detail: selects, comboboxes,
    // focusable descendants.
    detailSelects: detail ? detail.querySelectorAll("select").length : -1,
    detailComboboxes: detail ? detail.querySelectorAll('[role="combobox"]').length : -1,
    detailFocusable: detail ? detail.querySelectorAll("[tabindex]").length : -1,
    rows: detail ? [...detail.children].map(r => r.className) : [],
    hasSwatch: !!panel?.querySelector(".foliplus-style-fill-color-input"),
    hasField: !!panel?.querySelector(".foliplus-style-fill-field-select"),
    hasMethod: !!panel?.querySelector(".foliplus-style-fill-method-select"),
    hasClasses: !!panel?.querySelector(".foliplus-style-fill-classes-select"),
    hasScheme: !!panel?.querySelector(".foliplus-style-scheme-trigger"),
    noteInPanel: !!panel?.querySelector(".foliplus-style-fill-note"),
    // 380px-panel check: every read-only box must stay inside the panel.
    panelRight: panelRect ? Math.round(panelRect.right) : null,
    panelScroll: panel ? panel.scrollWidth - panel.clientWidth : -1,
    boxRightMax: widest.length ? Math.max(...widest) : null,
    fills,
  };
};
