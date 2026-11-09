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
  return readState();
};
