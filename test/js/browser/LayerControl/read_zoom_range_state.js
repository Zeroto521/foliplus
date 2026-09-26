() => {
  // Read the heatmap's stored zoom range and its provenance marker, so a
  // commit can be checked against storage after the write debounce has flushed.
  const row = document.querySelector(
    '.foliplus-layer-item[data-layer-id^="foliplus_heatmap"]',
  );
  if (!row) return { error: "heatmap row not found" };
  const id = row.getAttribute("data-layer-id");
  const key = Object.keys(localStorage).find(k =>
    k.startsWith("foliplus_layer_state_"),
  );
  const record = key ? JSON.parse(localStorage.getItem(key) || "null") : null;
  const entry = record && record.layers ? record.layers[id] : null;
  return {
    id,
    stored: entry ? entry.zoomRange : null,
    overrides: entry ? entry.overrides : null,
  };
};
