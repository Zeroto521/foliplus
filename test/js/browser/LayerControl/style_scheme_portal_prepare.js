// Switches the style drawer's fill row to the by-value arm and reports the live
// centre of the scheme trigger.
//
// The picker opens on a real press, and the regression this supports lives in
// the document mousedown capture phase — `element.click()` never triggers it.
// The caller therefore presses the trigger and then the colour row with the
// mouse; this probe only prepares the drawer and measures the points.
async () => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { ok: false, reason: "no-panel" };
  const mode = panel.querySelector(".foliplus-style-fill-mode-select");
  if (!mode) return { ok: false, reason: "no-mode-select" };
  if (mode.value !== "ramp") {
    mode.value = "ramp";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    // The row rebuilds its detail for the new arm; let it settle so the trigger
    // measured below is the live one with its picker bound.
    await new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }
  const trigger = panel.querySelector(".foliplus-style-scheme-trigger");
  if (!trigger) return { ok: false, reason: "no-scheme-trigger" };
  const rect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  return {
    ok: true,
    mode: mode.value,
    triggerX: rect.left + rect.width / 2,
    triggerY: rect.top + rect.height / 2,
    dropdownPresent: !!document.querySelector(".foliplus-scheme-picker-portal"),
    panelRect: {
      left: panelRect.left,
      top: panelRect.top,
      right: panelRect.right,
      bottom: panelRect.bottom,
    },
    viewport: { width: innerWidth, height: innerHeight },
  };
};
