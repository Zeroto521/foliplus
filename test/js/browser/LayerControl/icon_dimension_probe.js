// Drives the icon dimension row and reads the real marker DOM.
//
// ([field, reset] = []) — selects *field* in the icon row's field picker when
// given, clicks the panel Reset when *reset* is truthy, and always returns the
// marker elements' live class names after the frame-coalesced write flushes.
// The probe runs in one evaluate so the marker set is read at one instant.
async (arg = []) => {
  // Playwright passes `null` when evaluate() is called without an argument,
  // and a list otherwise; the default only covers undefined, so normalise here.
  const [field, reset] = Array.isArray(arg) ? arg : [];
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { panel: false };
  const iconRow = panel.querySelector(".foliplus-style-icon-row");
  if (!iconRow) return { panel: true, iconRow: false };
  const select = iconRow.querySelector("select");
  if (!select) return { panel: true, iconRow: true, select: false };

  const flush = () =>
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  if (field) {
    select.value = field;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
  }
  if (reset) {
    const resetBtn = panel.querySelector(".foliplus-style-reset-btn");
    if (resetBtn) resetBtn.click();
    await flush();
  }

  const icons = Array.from(document.querySelectorAll(".leaflet-marker-icon")).map(
    el => {
      const cls = el.className;
      const match = cls.match(/foliplus-marker-symbol--(\w+)/);
      return {
        cls,
        symbol: match ? match[1] : null,
        hasSymbolClass: cls.includes("foliplus-marker-symbol"),
      };
    },
  );
  return { panel: true, iconRow: true, select: true, fieldValue: select.value, icons };
};
