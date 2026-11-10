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
// The mode is applied FIRST, because a mode switch rebuilds the detail slot
// (the old color/weight inputs are detached). Color/weight are then written
// through the freshly built inputs. A color is only written when the input is
// not disabled (a read-only ORIGINAL swatch must not accept a write).
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

  row.querySelector(".foliplus-layer-more-btn").click();
  const styleItem = row.querySelector(
    '.foliplus-layer-more-menu button[data-action="style-layer"]',
  );
  if (!styleItem) return { row: true, styleItem: false };
  styleItem.click();

  const panel = row.querySelector(".foliplus-layer-style-panel");
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

  // A mode switch or a colour/width write schedules the persistence write
  // behind a 100ms debounce (SAVE_DEBOUNCE_MS); the style apply itself runs on
  // the frame clock. Poll until the persisted record reflects the values this
  // call wrote (or time out) so the record asserted on is the one the control
  // actually committed — a fixed sleep, or polling only for the key's
  // existence, would be flaky or stale on a loaded CI runner (the key from the
  // previous call already exists, so existence alone returns before the new
  // write's debounce has landed).
  const wroteSomething = mode !== undefined || color !== undefined || weight != null;
  const parseRecord = () => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes("layer_state")) {
        try {
          return { key, record: JSON.parse(localStorage.getItem(key)) };
        } catch {
          return null;
        }
      }
    }
    return null;
  };
  const storageSnapshot = () => {
    const storage = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes("layer_state")) {
        storage[key] = localStorage.getItem(key);
      }
    }
    return storage;
  };
  const recordMatches = () => {
    if (!wroteSomething) return true;
    const parsed = parseRecord();
    if (!parsed || !parsed.record) return false;
    const entry = parsed.record.layers && parsed.record.layers[id];
    if (!entry) return false;
    if (mode !== undefined && entry.borderStyleMode !== mode) return false;
    if (color !== undefined && entry.borderColor !== color) return false;
    if (weight != null && entry.borderWeight !== weight) return false;
    return true;
  };
  const pollRecord = attemptsLeft => {
    if (recordMatches() || attemptsLeft <= 0) {
      return Promise.resolve(storageSnapshot());
    }
    return new Promise(resolvePoll =>
      setTimeout(() => resolvePoll(pollRecord(attemptsLeft - 1)), 50),
    );
  };

  // Let the debounced/RAF apply land before reading computed style.
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pollRecord(12).then(storage => {
          const colorInput = panel.querySelector(".foliplus-style-border-color-input");
          resolve({
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
          });
        });
      });
    });
  });
};
