async () => {
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
  const map = ctrl.mgr.map;
  const ui = ctrl.mgr.ui;

  // A GeoJSON layer carries zoomRange capability "pane", so its style panel
  // renders the wa-slider range row.
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
  ctrl.mgr.enforceOrder();
  ui.openStylePanel("ng_gate");

  // The wa-slider host. The max thumb rests at the map's max zoom, so
  // ArrowDown has room to step it — the min thumb starts at mapMin and
  // cannot go further down. min-value/max-value are the contract surface
  // (foliplus-written attributes, applied on upgrade).
  const slider = document.querySelector(
    ".foliplus-style-zoom-range-row wa-slider",
  );
  if (!slider) {
    ui.closeStylePanel(false);
    return { error: "zoom range wa-slider not rendered" };
  }

  // The shadow root exists as soon as the element upgrades, but the Lit
  // render is async: the thumbs land on the next update. Wait for the first
  // render before reaching into the shadow DOM (a bounded wait — the
  // component owns its lifecycle, this is the driving gesture).
  await slider.updateComplete;

  // Focus the max thumb the way a user does (a click lands in the shadow
  // DOM); document.activeElement retargets to the host, which is what the
  // input-ownership table sees. Reaching into the shadow root here is the
  // driving gesture, not an assertion on wa internals.
  const thumb = slider.shadowRoot
    ? slider.shadowRoot.querySelector('[part="thumb-max"], [part~="thumb-max"]')
    : null;
  if (!thumb) {
    const parts = slider.shadowRoot
      ? [...slider.shadowRoot.querySelectorAll("[part]")].map(
          e => `${e.id || e.tagName}:${e.getAttribute("part")}`,
        )
      : [];
    const sr = slider.shadowRoot ? "open" : "none";
    ui.closeStylePanel(false);
    return { error: "max thumb part not found in shadow root", sr, parts };
  }
  thumb.focus();

  const row = document.querySelector('.foliplus-layer-item[data-layer-id="ng_gate"]');
  const cb = row ? row.querySelector('input[type="checkbox"]') : null;
  // Baseline cursor state before the press. Read before any focus move in this
  // probe: a later `focus()` on a row descendant legally re-homes the cursor,
  // so a post-press read alone cannot say who moved it.
  const rowFocused = !!document.querySelector(".foliplus-is-focused-row");
  return {
    sliderBefore: Number(slider.maxValue),
    sliderStep: Number(slider.step),
    sliderMin: Number(slider.min),
    sliderMax: Number(slider.max),
    mapMax: Number(map.getMaxZoom()),
    focusedTag: document.activeElement.tagName.toLowerCase(),
    cbBefore: cb ? cb.checked : null,
    rowFocused,
  };
};
