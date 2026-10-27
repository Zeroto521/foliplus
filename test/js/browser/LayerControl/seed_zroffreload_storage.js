// Seed localStorage with a zoomRange state entry for 'ZROffReload' so the
// reload-replay path has something to restore. Throws when the layer is
// missing so the caller can distinguish "state not written" from "layer
// not found".
() => {
  const el = document.querySelector(".leaflet-container");
  const map = (el && window[el.id]) || window.map;
  const api = map.foliplus && map.foliplus.LayerAPI;
  const layer = api.layers.find(l => l.name === "ZROffReload");
  const id = layer ? layer.id : null;
  if (!id) throw new Error("ZROffReload not found in registry");
  const key = "foliplus_layer_state_" + el.id;
  const record = JSON.parse(localStorage.getItem(key) || "{}");
  record.version = 1;
  record.order = record.order || null;
  record.foldedRoles = record.foldedRoles || [];
  record.renamedNames = record.renamedNames || {};
  record.annotations = record.annotations || {};
  record.layers = record.layers || {};
  record.layers[id] = {
    zoomRange: [3, 12],
    overrides: ["zoomRange"],
  };
  localStorage.setItem(key, JSON.stringify(record));
  return id;
};
