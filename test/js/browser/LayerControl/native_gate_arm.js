() => {
  // Record keydowns observed on document through Chromium's own pipeline —
  // a capture listener reports the browser's final `defaultPrevented`, so
  // "foliplus did not cancel this key" is a measured fact, not an inference.
  // Installed once; every arm resets the log so each press is read on its own.
  if (!window.__inputGate) {
    window.__inputGate = { records: [] };
    document.addEventListener(
      "keydown",
      e => {
        window.__inputGate.records.push({
          key: e.key,
          tag: e.target.tagName.toLowerCase(),
          type: e.target.type || "",
          prevented: e.defaultPrevented,
        });
      },
      true,
    );
  }
  window.__inputGate.records = [];

  const ctrl = window.__layerCtrl;
  const map = ctrl.m.map;
  const ui = ctrl.m.ui;

  // A GeoJSON layer carries zoomRange capability "pane", so its style panel
  // renders the dual-thumb slider.
  const geo = L.geoJson({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "p1" },
        geometry: { type: "Point", coordinates: [119.3, 26.08] },
      },
    ],
  });
  map.foliplus.LayerAPI.registerLayer({ id: "ng_gate", name: "NGGate", layer: geo });
  ctrl.m.enforceOrder();
  ui.openStylePanel("ng_gate");

  // The max thumb rests at the map's max zoom, so ArrowDown has room to step
  // it — the min thumb starts at mapMin and cannot go further down.
  const slider = document.querySelector(".foliplus-style-zoom-range-max");
  if (!slider || slider.type !== "range") {
    ui.closeStylePanel(false);
    return { error: "zoom range max slider not rendered" };
  }
  slider.focus();

  const row = document.querySelector('.foliplus-layer-item[data-layer-id="ng_gate"]');
  const cb = row ? row.querySelector('input[type="checkbox"]') : null;
  // Baseline cursor state before the press. Read before any focus move in this
  // probe: a later `focus()` on a row descendant legally re-homes the cursor,
  // so a post-press read alone cannot say who moved it.
  const rowFocused = !!document.querySelector(".is-focused-row");
  return {
    sliderBefore: Number(slider.value),
    sliderStep: Number(slider.step),
    sliderMin: Number(slider.min),
    sliderMax: Number(slider.max),
    mapMax: Number(map.getMaxZoom()),
    focusedType: document.activeElement.type,
    cbBefore: cb ? cb.checked : null,
    rowFocused,
  };
};
