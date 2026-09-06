() => {
  // Read back, per row: whether the checkbox is checked, whether the registry
  // still says the layer is visible, and whether the Leaflet layer is actually
  // attached to the map. Each half of the projection is asserted separately, so
  // neither a UI-only nor a data-only mishap can slip past this guard.
  const rows = document.querySelectorAll(
    '[data-layer-type]:not([data-layer-type="base"])',
  );
  const map = window.map;
  const resolve = id => (map?._layers && map._layers[id]) || window[id] || null;
  const out = [];
  rows.forEach(row => {
    const id = row.getAttribute("data-layer-id");
    const cb = row.querySelector('input[type="checkbox"]');
    const info = map?.foliplus?.LayerAPI?.layers.find(l => l.id === id);
    const layer = info?.layer || resolve(id);
    out.push({
      id,
      checked: cb?.checked ?? null,
      visible: info?.visible ?? null,
      onMap: layer ? !!map.hasLayer(layer) : null,
    });
  });
  // Registry entries must back every rendered row -- otherwise the row state
  // has no source of truth and this test cannot say whether the reload
  // honoured the persisted hidden set.
  const missing = out.filter(r => r.visible === null).map(r => r.id);
  if (missing.length) {
    throw new Error(
      `registry has no entry for ${missing.length} rendered row(s): ${missing.join(", ")}`,
    );
  }
  return {
    rows: out,
    // Layers the map thinks it holds, by stamp -- the registry id never appears
    // in here, so this is what decides whether a "hidden" layer is actually off
    // the map.
    mapCount: map ? Object.keys(map._layers).length : null,
    storage: Object.keys(localStorage)
      .filter(k => k.includes("foliplus"))
      .reduce((a, k) => ((a[k] = localStorage.getItem(k)), a), {}),
  };
};
