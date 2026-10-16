// Look up the stored zoomRange entry for a given layer id in the LayerControl
// localStorage record. Returns nulls when the record or the entry is missing.
id => {
  const key = Object.keys(localStorage).find(k =>
    k.startsWith("foliplus_layer_state_"),
  );
  const record = key ? JSON.parse(localStorage.getItem(key) || "null") : null;
  const entry = record && record.layers ? record.layers[id] : null;
  return {
    stored: entry ? entry.zoomRange : null,
    overrides: entry ? entry.overrides : null,
  };
};
