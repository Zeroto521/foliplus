// Reads the style panel state for one layer and the computed stroke of the
// map's stroked paths, WITHOUT writing any border mode. The point is the
// DECLARED follow_fill default: a layer stamped with
// foliplus={"border": {"mode": "follow_fill"}} must open its border mode
// select on followFill with no stored intent, and the map must paint the
// leaf's current fill colour as the stroke (derived, never copied).
//
// Synchronous (no Promise/setTimeout) per the border_original_roundtrip
// contract: the driver waits for debounces between calls.
//
// Optional [fillColor] sets the leaf's fill through the fill row so the
// derived stroke can be asserted against a KNOWN fill colour.
([layerName, fillColor] = []) => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const byName =
    api && Array.isArray(api.layers)
      ? api.layers.find(l => l.name === layerName)
      : undefined;

  let row = document.querySelector(
    `[data-layer-id="${CSS.escape(layerName)}"][data-layer-type]`,
  );
  if (!row && byName && byName.id) {
    row = document.querySelector(
      `[data-layer-id="${CSS.escape(byName.id)}"][data-layer-type]`,
    );
  }
  if (!row) {
    const rows = document.querySelectorAll(
      `[data-layer-type]:not([data-layer-type="base"])`,
    );
    row = Array.from(rows).find(r => r.textContent.includes(layerName));
  }
  if (!row) return { row: false, layers: api ? api.layers.map(l => l.id) : null };

  let panel = row.querySelector(".foliplus-layer-style-panel");
  if (!panel) {
    row.querySelector(".foliplus-layer-more-btn").click();
    const styleItem = row.querySelector(
      '.foliplus-layer-more-menu button[data-action="style-layer"]',
    );
    if (!styleItem) return { row: true, styleItem: false };
    styleItem.click();
    panel = row.querySelector(".foliplus-layer-style-panel");
  }
  if (!panel) return { row: true, styleItem: true, panel: false };

  const modeSelect = panel.querySelector(".foliplus-style-border-mode-select");
  if (fillColor) {
    const fillInput = panel.querySelector(".foliplus-style-fill-color-input");
    if (fillInput && !fillInput.disabled) {
      fillInput.value = fillColor;
      fillInput.dispatchEvent(new Event("input", { bubbles: true }));
      fillInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  const storage = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.includes("layer_state")) continue;
    const raw = localStorage.getItem(key);
    try {
      const parsed = JSON.parse(raw);
      storage[key] = JSON.stringify(parsed && parsed.data ? parsed.data : parsed);
    } catch {
      storage[key] = raw;
    }
  }

  return {
    row: true,
    panel: true,
    id: row.getAttribute("data-layer-id"),
    mode: modeSelect ? modeSelect.value : null,
    modes: modeSelect ? Array.from(modeSelect.options).map(o => o.value) : null,
    hasColorInput: !!panel.querySelector(".foliplus-style-border-color-input"),
    storage,
    strokes: Array.from(
      document.querySelectorAll(".leaflet-map-pane path[stroke]"),
    ).map(el => {
      const cs = getComputedStyle(el);
      return {
        stroke: cs.stroke,
        strokeWidth: cs.strokeWidth,
        fill: cs.fill,
      };
    }),
  };
};
