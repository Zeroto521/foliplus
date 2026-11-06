// Drives the icon dimension row and reads the real marker DOM.
//
// ([glyph, reset] = []) — opens the trigger's grid and clicks the cell for
// *glyph* when given, clicks the panel Reset when *reset* is truthy, and
// always returns the marker elements' live class/style after the
// frame-coalesced write flushes. The probe runs in one evaluate so the
// marker set is read at one instant.
//
// On the FIRST call it snapshots the author baseline (className /
// backgroundImage / backgroundPosition / iconSize of the first marker
// element and its icon.options) into window.__iconProbeBaseline, so a later
// call can diff the derived icon against the author pixel-for-pixel. The
// inner <i> className + computed colour are captured too: the glyph swap
// must carry the author's symbol paint (class + color), so the derived
// marker's inner <i> must keep them (lead m04384).
async (arg = []) => {
  // Playwright passes `null` when evaluate() is called without an argument,
  // and a list otherwise; the default only covers undefined, so normalise here.
  const [glyph, reset] = Array.isArray(arg) ? arg : [];
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { panel: false };
  const iconRow = panel.querySelector(".foliplus-style-icon-row");
  if (!iconRow) return { panel: true, iconRow: false };
  const trigger = iconRow.querySelector(".foliplus-style-icon-trigger");
  if (!trigger) return { panel: true, iconRow: true, trigger: false };

  const flush = () =>
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const readInner = el => {
    const inner = el?.querySelector("i");
    if (!inner) return null;
    return { cls: inner.className, color: getComputedStyle(inner).color };
  };

  // Author baseline: read before any user write touches the marker set.
  if (!window.__iconProbeBaseline) {
    const first = document.querySelector(".leaflet-marker-icon");
    if (first) {
      const cs = getComputedStyle(first);
      window.__iconProbeBaseline = {
        cls: first.className,
        backgroundImage: cs.backgroundImage,
        backgroundPosition: cs.backgroundPosition,
        iconSize: first.getBoundingClientRect()
          ? [
              Math.round(first.getBoundingClientRect().width),
              Math.round(first.getBoundingClientRect().height),
            ]
          : null,
        inner: readInner(first),
      };
    }
  }

  if (glyph) {
    trigger.click();
    const grid = iconRow.querySelector(".foliplus-style-icon-grid");
    const cell = grid?.querySelector(
      `.foliplus-style-icon-cell[data-glyph="${glyph}"]`,
    );
    if (cell) {
      cell.click();
      await flush();
    }
  }
  if (reset) {
    const resetBtn = panel.querySelector(".foliplus-style-reset-btn");
    window.__resetFound = !!resetBtn;
    if (resetBtn) resetBtn.click();
    await flush();
    window.__panelAfterReset = !!document.querySelector(".foliplus-layer-style-panel");
  }

  const first = document.querySelector(".leaflet-marker-icon");
  const readIcon = el => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      cls: el.className,
      backgroundImage: cs.backgroundImage,
      backgroundPosition: cs.backgroundPosition,
      iconSize: [
        Math.round(el.getBoundingClientRect().width),
        Math.round(el.getBoundingClientRect().height),
      ],
      inner: readInner(el),
    };
  };
  const icons = Array.from(document.querySelectorAll(".leaflet-marker-icon")).map(
    el => ({
      cls: el.className,
      hasGlyph: !!el.querySelector(".foliplus-marker-glyph"),
      glyphSvg: el.querySelector(".foliplus-marker-glyph")?.innerHTML ?? null,
    }),
  );
  const baseline = window.__iconProbeBaseline ?? null;
  const after = readIcon(first);
  return {
    panel: true,
    iconRow: true,
    trigger: true,
    resetFound: window.__resetFound ?? null,
    panelAfterReset: window.__panelAfterReset ?? null,
    icons,
    // Pixel-identical evidence for the lead (m01511): the first marker after
    // the write must match the author baseline field-for-field.
    derived: after,
    author: baseline,
    derivedMatchesAuthor:
      baseline && after
        ? baseline.cls === after.cls &&
          baseline.backgroundImage === after.backgroundImage &&
          baseline.backgroundPosition === after.backgroundPosition &&
          JSON.stringify(baseline.iconSize) === JSON.stringify(after.iconSize)
        : null,
    // Colour / class contract (lead m04384): the derived inner <i> keeps the
    // author's class and computed colour after the glyph swap.
    innerKeepsAuthor:
      baseline?.inner && after?.inner
        ? baseline.inner.color === after.inner.color &&
          baseline.inner.cls
            .split(/\s+/).filter(Boolean)
            .every(c => after.inner.cls.split(/\s+/).includes(c))
        : null,
  };
};
