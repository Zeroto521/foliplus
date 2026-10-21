() => {
  // Record keydowns observed on document through Chromium's own pipeline.
  // `prevented` is a getter over the live event: a capture listener runs
  // BEFORE the target handler, so reading the boolean here would only ever
  // report false. The probe's read step serialises the getter after dispatch.
  // Installed once; every arm resets the log so each press is read on its own.
  if (!window.__inputGate) {
    window.__inputGate = { records: [] };
    document.addEventListener(
      "keydown",
      e => {
        window.__inputGate.records.push({
          key: e.key,
          tag: e.target.tagName.toLowerCase(),
          type: e.target.type || e.target.getAttribute("role") || "",
          get prevented() {
            return e.defaultPrevented;
          },
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
  ctrl.mgr.enforceOrder();
  ui.openStylePanel("ng_gate");

  // The max thumb rests at the map's max zoom, so ArrowDown has room to step
  // it — the min thumb starts at mapMin and cannot go further down.
  const host = document.querySelector(".foliplus-style-zoom-range-control");
  const thumb = host ? host.querySelectorAll(".foliplus-slider-thumb")[1] : null;
  if (!thumb || thumb.getAttribute("role") !== "slider") {
    ui.closeStylePanel(false);
    return { error: "zoom range max thumb not rendered" };
  }
  thumb.focus();

  const row = document.querySelector('.foliplus-layer-item[data-layer-id="ng_gate"]');
  const cb = row ? row.querySelector('input[type="checkbox"]') : null;
  // Baseline cursor state before the press. Read before any focus move in this
  // probe: a later `focus()` on a row descendant legally re-homes the cursor,
  // so a post-press read alone cannot say who moved it.
  const rowFocused = !!document.querySelector(".foliplus-is-focused-row");
  return {
    sliderBefore: Number(thumb.getAttribute("aria-valuenow")),
    sliderStep: 1,
    sliderMin: Number(thumb.getAttribute("aria-valuemin")),
    sliderMax: Number(thumb.getAttribute("aria-valuemax")),
    mapMax: Number(map.getMaxZoom()),
    focusedType:
      document.activeElement.type || document.activeElement.getAttribute("role") || "",
    cbBefore: cb ? cb.checked : null,
    rowFocused,
  };
};
