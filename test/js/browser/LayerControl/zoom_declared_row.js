() => {
  // The declared layer's zoom-range row: the values it opens on.
  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "no __layerCtrl" };
  const map = ctrl.mgr.map;
  const ui = ctrl.mgr.ui;
  const api = map.foliplus.LayerAPI;
  const declared = api.layers.find(li => li.name === "Declared");
  if (!declared) return { error: "declared layer not registered" };

  ui.openStylePanel(declared.id);
  const host = document.querySelector(".foliplus-style-zoom-range-control");
  if (!host) {
    ui.closeStylePanel(false);
    return { error: "zoom range row not rendered" };
  }
  const thumbs = host.querySelectorAll(".foliplus-slider-thumb");
  const out = {
    rowMin: Number(thumbs[0].getAttribute("aria-valuenow")),
    rowMax: Number(thumbs[thumbs.length - 1].getAttribute("aria-valuenow")),
    railMin: Number(thumbs[0].getAttribute("aria-valuemin")),
    railMax: Number(thumbs[thumbs.length - 1].getAttribute("aria-valuemax")),
  };
  ui.closeStylePanel(false);
  return out;
};
