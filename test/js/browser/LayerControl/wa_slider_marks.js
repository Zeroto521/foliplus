// The foliplus-owned marks must sit on the library's rail: the end dots
// centred on the track's two ends and on its centre line, the current-zoom
// marker inside the track's span. The marks are light-DOM overlays positioned
// from the row's own box, so this guards foliplus' half-thumb arithmetic —
// the one thing a shadow-DOM component cannot give us.
async () => {
  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "no __layerCtrl" };
  const ui = ctrl.mgr.ui;
  const api = ctrl.mgr.map.foliplus.LayerAPI;

  const geo = L.geoJson({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "p" },
        geometry: { type: "Point", coordinates: [119.3, 26.08] },
      },
    ],
  });
  api.registerLayer({ id: "marks", name: "Marks", layer: geo });
  ctrl.mgr.enforceOrder();

  // A zero-layout ancestor collapses every rect inside it to 0x0.
  const layerCtrl = document.querySelector(".foliplus-layer-ctrl");
  if (layerCtrl && !layerCtrl.classList.contains("foliplus-is-expanded")) {
    layerCtrl.querySelector(".foliplus-toggle-btn")?.click();
  }
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  ui.openStylePanel("marks");
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const centre = r => ({
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2,
    left: r.left,
    right: r.right,
  });

  const measure = (rowSelector, markerSelector) => {
    const row = document.querySelector(rowSelector);
    if (!row) return { error: "row missing" };
    const slider = row.querySelector("wa-slider");
    const shadow = slider && slider.shadowRoot;
    const track = shadow && shadow.querySelector('[part="track"]');
    if (!track) return { error: "track missing" };
    const dots = {};
    for (const side of ["min", "max"]) {
      const dot = row.querySelector(`.foliplus-slider-dot-${side}`);
      if (!dot) return { error: `dot ${side} missing` };
      dots[side] = centre(dot.getBoundingClientRect());
    }
    const marker = markerSelector && row.querySelector(markerSelector);
    return {
      track: centre(track.getBoundingClientRect()),
      dotMin: dots.min,
      dotMax: dots.max,
      marker: marker ? centre(marker.getBoundingClientRect()) : null,
      // The scale's numbers are foliplus-owned: the library's reference slot
      // lays them out with flex space-between, which cannot centre a label on
      // the rail's end.
      referenceSlots: slider.querySelectorAll('[slot="reference"]').length,
      values: row.querySelectorAll(".foliplus-slider-values > span").length,
    };
  };

  const result = {
    opacity: measure(".foliplus-style-opacity-track", null),
    zoom: measure(
      ".foliplus-style-zoom-range-row",
      ".foliplus-style-zoom-range-current-marker",
    ),
  };
  ui.closeStylePanel(false);
  return result;
};
