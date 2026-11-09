// Keyboard-ownership probe for the open glyph grid.
//
// Actions:
//   "setup"          — open panel + style panel, return the icon row/trigger.
//   "focusSlider"    — focus the fill-opacity slider thumb, return focus state.
//   "focusTrigger"   — focus the icon trigger, return focus state.
//   "openGrid"       — open the icon grid (trigger.click()), return grid state.
//   "state"          — read activeElement / grid / layer visibility.
//   "commitCell"     — click the first cell (used by the Python test after keyboard).
//
// The Python test drives the REAL keyboard (page.keyboard.press) between calls, so
// the probe only reads state or performs a single deterministic DOM step.
async (action = "state") => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { ok: false, reason: "no-style-panel" };
  const iconRow = panel.querySelector(".foliplus-style-icon-row");
  if (!iconRow) return { ok: false, reason: "no-icon-row" };
  const trigger = iconRow.querySelector(".foliplus-style-icon-trigger");
  if (!trigger) return { ok: false, reason: "no-icon-trigger" };
  const grid = iconRow.querySelector(".foliplus-style-icon-grid");
  const slider = panel.querySelector("[role=slider]");

  const readState = () => {
    const active = document.activeElement;
    const cells = grid
      ? Array.from(grid.querySelectorAll(".foliplus-style-icon-cell"))
      : [];
    const focusCell = cells.findIndex(c => c === active);
    // The style panel is portalled out of the row, so find the layer row it
    // was opened for by the first overlay row (open_style_panel opens that one).
    const overlayRow = document.querySelector(
      ".foliplus-layer-item[data-layer-type=overlay]",
    );
    const checkbox = overlayRow?.querySelector('input[type="checkbox"]');
    const allChecks = Array.from(document.querySelectorAll(".foliplus-checkbox")).map(
      c => ({ checked: c.checked, aria: c.getAttribute("aria-checked") }),
    );
    // Focus-ring contract: a focused grid cell must show the shared ring, not
    // the browser default outline. Read the computed style of the focused cell.
    const focusedCell = active instanceof HTMLElement ? active : null;
    const focusedInGrid = focusedCell && grid?.contains(focusedCell);
    const focusStyle = focusedInGrid
      ? {
          outlineStyle: getComputedStyle(focusedCell).outlineStyle,
          boxShadow: getComputedStyle(focusedCell).boxShadow,
          focusColor: getComputedStyle(focusedCell)
            .getPropertyValue("--foliplus-focus-color")
            .trim(),
        }
      : null;
    return {
      ok: true,
      gridOpen: !!grid && grid.isConnected,
      cellCount: cells.length,
      gridHasFocus: !!grid && grid.contains(active),
      focusCell: focusCell >= 0 ? focusCell : null,
      focusTag: active ? active.tagName : null,
      focusInGrid: !!grid && grid.contains(active),
      focusOnTrigger: active === trigger,
      focusOnSlider: !!slider && active === slider,
      sliderValue: slider ? slider.value : null,
      triggerExpanded: trigger.getAttribute("aria-expanded"),
      layerChecked: checkbox ? checkbox.checked : null,
      allChecks,
      focusStyle,
    };
  };

  const flush = () =>
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  if (action === "setup") {
    return { ok: true, trigger: !!trigger, slider: !!slider };
  }
  if (action === "focusTrigger") {
    trigger.focus();
    await flush();
    return readState();
  }
  if (action === "focusSlider") {
    if (!slider) return { ok: false, reason: "no-slider" };
    slider.focus();
    await flush();
    return readState();
  }
  if (action === "openGrid") {
    trigger.click();
    await flush();
    return readState();
  }
  if (action === "focusFirstCell") {
    const cell = grid?.querySelector(".foliplus-style-icon-cell");
    if (!cell) return { ok: false, reason: "no-grid-cell" };
    cell.focus();
    await flush();
    return readState();
  }
  if (action === "rowMetrics") {
    const row = document.querySelector(".foliplus-style-icon-row");
    const triggerEl = document.querySelector(".foliplus-style-icon-trigger");
    const nameEl = document.querySelector(".foliplus-style-icon-trigger-name");
    if (!row || !triggerEl || !nameEl) return { ok: false, reason: "no-icon-row" };
    const control = row.querySelector(".foliplus-form-control");
    const trigRect = triggerEl.getBoundingClientRect();
    const controlRect = control ? control.getBoundingClientRect() : null;
    return {
      ok: true,
      rowWidth: Math.round(row.getBoundingClientRect().width),
      controlWidth: controlRect ? Math.round(controlRect.width) : 0,
      triggerWidth: Math.round(trigRect.width),
      // The trigger must span its control cell (the shared control column),
      // so the icon row lines up with every other style/heatmap input row.
      triggerFillsControl: controlRect
        ? trigRect.width >= controlRect.width - 2
        : false,
      // A long glyph name must ellipsize, never widen the row or clip mid-glyph.
      nameOverflows: nameEl.scrollWidth > nameEl.clientWidth + 1,
      nameScrollWidth: nameEl.scrollWidth,
      nameClientWidth: nameEl.clientWidth,
    };
  }
  if (action === "cellRect") {
    const cell = grid?.querySelector(".foliplus-style-icon-cell");
    if (!cell) return { ok: false, reason: "no-grid-cell" };
    const r = cell.getBoundingClientRect();
    return {
      ok: true,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      outlineStyle: getComputedStyle(cell).outlineStyle,
      boxShadow: getComputedStyle(cell).boxShadow,
    };
  }
  return readState();
};
