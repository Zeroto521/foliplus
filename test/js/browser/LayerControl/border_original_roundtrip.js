// Opens the ⋮ → Style panel for one layer row, optionally switches the border
// mode select and writes the border color/width through the row's own inputs,
// then reports the mode, the color input's editability, the persisted record,
// and the COMPUTED style of the map's stroked paths.
//
// The point of this snippet is the solid → ORIGINAL round trip: a colour the
// user wrote in solid mode must revert to the author's stroke when the mode
// returns to original — asserted on getComputedStyle (what the browser paints),
// never on DOM attributes or source strings.
//
// This snippet is deliberately SYNCHRONOUS (no Promise, no setTimeout): the
// driver waits for the 100ms persistence debounce and the style-apply frame
// between calls (page.wait_for_timeout), so the browser side only dispatches
// events and reads state. A setTimeout-recursive promise inside page.evaluate
// gets its result promise garbage collected and is what hung the browser job.
//
// The mode is applied FIRST, because a mode switch rebuilds the detail slot
// (the old color/weight inputs are detached). Color/weight are then written
// through the freshly built inputs. A color is only written when the input is
// not disabled (a read-only ORIGINAL swatch must not accept a write).
//
// The panel is opened only if it is not already open (idempotent across the
// driver's repeated calls), so re-reading the state after a wait does not
// re-click the menu.
//
// Page.evaluate takes one argument, so the four arrive as a list. An omitted
// tail stays undefined, which is what the read-only calls rely on.
([layerName, mode, color, weight] = []) => {
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
  if (modeSelect && mode) {
    modeSelect.value = mode;
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Re-query after the mode switch rebuilt the detail slot.
  const setColor = panel.querySelector(".foliplus-style-border-color-input");
  const setWeight = panel.querySelector(".foliplus-style-border-weight-input");
  if (setColor && color && !setColor.disabled) {
    setColor.value = color;
    setColor.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (setWeight && weight !== null && weight !== undefined) {
    setWeight.value = String(weight);
    setWeight.dispatchEvent(new Event("input", { bubbles: true }));
    setWeight.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const colorInput = panel.querySelector(".foliplus-style-border-color-input");

  // The storage key carries the map's own suffix, so the test never has to
  // know it.
  const storage = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.includes("layer_state")) {
      storage[key] = localStorage.getItem(key);
    }
  }

  return {
    row: true,
    panel: true,
    id: row.getAttribute("data-layer-id"),
    mode: modeSelect ? modeSelect.value : null,
    colorInput: colorInput
      ? {
          value: colorInput.value,
          readOnly: colorInput.readOnly,
          disabled: colorInput.disabled,
        }
      : null,
    weight: setWeight ? setWeight.value : null,
    storage,
    strokes: Array.from(
      // Map panes only — control chrome (icons) also ships path[stroke]
      // with currentColor and is not a layer stroke.
      document.querySelectorAll(".leaflet-map-pane path[stroke]"),
    ).map(el => {
      const cs = getComputedStyle(el);
      return {
        stroke: cs.stroke,
        strokeWidth: cs.strokeWidth,
        strokeDasharray: cs.strokeDasharray,
        fillOpacity: cs.fillOpacity,
      };
    }),
  };
};
