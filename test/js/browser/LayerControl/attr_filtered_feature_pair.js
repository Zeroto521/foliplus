// Attributes → Features for a filtered owner: registers a capability layer whose
// committed filter reports kept 2500 / total 6000, opens its attrs panel, reads
// the Features row, then unregisters the probe. Returns the rendered pair (and
// the row's label text) so the caller can assert the grouped kept / total value.
() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const ID = "__attr_pair_probe__";
  api.registerLayer({
    id: ID,
    name: "Attr Pair Probe",
    layer: L.layerGroup(),
    filterProvider: () => ({
      field: "value",
      range: [0, 10],
      filter: { kind: "atom", field: "value", op: "between", range: [2, 8] },
      kept: 2500,
      total: 6000,
      step: 1,
    }),
    filterSetter: () => {},
  });
  const row = document.querySelector(`.foliplus-layer-item[data-layer-id="${ID}"]`);
  if (!row) {
    api.unregisterLayer(ID);
    return null;
  }
  row.querySelector(".foliplus-layer-more-btn")?.click();
  const entry = document.querySelector(
    ".foliplus-layer-more-menu li[data-action=layer-attributes]",
  );
  if (!entry) {
    api.unregisterLayer(ID);
    return null;
  }
  entry.click();
  const panel = document.querySelector(".foliplus-layer-attrs-panel");
  if (!panel) {
    api.unregisterLayer(ID);
    return null;
  }
  let pair = null;
  let label = null;
  for (const r of panel.querySelectorAll(".foliplus-form-row")) {
    const value = r.querySelector(".foliplus-form-control")?.textContent ?? "";
    if (/^\d[\d,]* \/ \d[\d,]*$/.test(value)) {
      pair = value;
      label = r.querySelector(".foliplus-form-label")?.textContent ?? null;
      break;
    }
  }
  api.unregisterLayer(ID);
  return { pair, label };
};
