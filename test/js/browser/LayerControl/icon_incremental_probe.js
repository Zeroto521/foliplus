// Verify the icon dimension's colour/opacity write paints the
// already-mounted inner glyph node IN PLACE — the same <i> element reference
// (no rebuild, no setIcon) while the computed colour updates, and that a
// glyph write still rebuilds (one setIcon). Runs against a real Leaflet
// runtime with an AwesomeMarkers author icon.
//
// arg: {} — drives the row itself.
// returns: { ok, before, afterColor, afterGlyph, setIconCalls, error }
async () => {
  const flush = () =>
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { ok: false, error: "no style panel" };
  const colorRow = panel.querySelector(".foliplus-style-icon-color-row");
  if (!colorRow) return { ok: false, error: "no icon color row" };
  const swatch = colorRow.querySelector('input[type="color"]');
  if (!swatch) return { ok: false, error: "no icon color swatch" };
  const iconRow = panel.querySelector(".foliplus-style-icon-row");
  const trigger = iconRow?.querySelector(".foliplus-style-icon-trigger");
  if (!trigger) return { ok: false, error: "no icon trigger" };

  const marker = window.__testMarker;
  if (!marker) return { ok: false, error: "no __testMarker" };

  // Patch setIcon to count rebuilds (only the first patch counts).
  if (!marker.__setIconCounted) {
    const orig = marker.setIcon.bind(marker);
    marker.__setIconCount = 0;
    marker.setIcon = (...args) => {
      marker.__setIconCount += 1;
      return orig(...args);
    };
    marker.__setIconCounted = true;
  }
  marker.__setIconCount = 0;

  const readGlyph = () => {
    const el = document.querySelector(
      ".leaflet-marker-pane .awesome-marker, .foliplus-layer-pane .awesome-marker, .awesome-marker",
    );
    if (!el) return null;
    const i = el.querySelector("i");
    return i ? { ref: i, cls: i.className, color: getComputedStyle(i).color } : null;
  };

  const before = readGlyph();

  // 1) Set a glyph (rebuild → setIcon 1).
  trigger.click();
  await flush();
  const grid = iconRow.querySelector(".foliplus-style-icon-grid");
  const cell = grid?.querySelector('.foliplus-style-icon-cell[data-glyph="star"]');
  if (cell) {
    cell.click();
    await flush();
  }
  const afterGlyph = readGlyph();
  const callsAfterGlyph = marker.__setIconCount;

  // 2) Write a colour (in place → setIcon stays).
  swatch.value = "#00ff00";
  swatch.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
  const afterColor = readGlyph();
  const callsAfterColor = marker.__setIconCount;

  return {
    ok: true,
    before: before ? { cls: before.cls, color: before.color } : null,
    afterGlyph: afterGlyph ? { cls: afterGlyph.cls, color: afterGlyph.color } : null,
    afterColor: afterColor ? { cls: afterColor.cls, color: afterColor.color } : null,
    sameElementAfterColor:
      afterColor && afterGlyph ? afterColor.ref === afterGlyph.ref : null,
    sameElementAfterGlyph: afterGlyph && before ? afterGlyph.ref === before.ref : null,
    callsAfterGlyph,
    callsAfterColor,
    setIconDeltaColor: callsAfterColor - callsAfterGlyph,
  };
};
