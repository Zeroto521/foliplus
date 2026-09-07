() => {
  // Read back, per row: whether the checkbox is checked, whether the registry
  // still says the layer is visible, and whether the Leaflet layer is actually
  // attached to the map. Each half of the projection is asserted separately, so
  // neither a UI-only nor a data-only mishap can slip past this guard.
  //
  // Rows are anchored by class, not by [data-layer-id]: renderLayerItem stamps
  // the id on the row and again on its count cell, so a [data-layer-id]
  // selector counts each layer twice. The per-group toggle-all row is not a
  // registered layer either -- a registry lookup on it throws and would turn
  // every assertion in the suite that reads this fixture into a false failure.
  const rows = document.querySelectorAll(
    ".foliplus-layer-item:not([data-layer-type='base']):not(.foliplus-color-layer-item)",
  );
  // folium declares the map as a per-map global named after the container's id,
  // not as window.map, so window.map is undefined and every map lookup through
  // it resolves to nothing. Tests that need window.map explicitly add a
  // `window.map = <map>` shim, so fall back to it only when the per-map global
  // is absent -- a bare `window[el.id]` would be undefined in that case and
  // make every map lookup throw.
  const el = document.querySelector(".leaflet-container");
  const globalMap = el ? window[el.id] : undefined;
  const map = globalMap || window.map;
  const api = map && map.foliplus ? map.foliplus.LayerAPI : null;
  // Registry entries carry no .layer for folium's TileLayer/FeatureGroup, so
  // the registry view alone cannot answer "is it on the map" -- the manager's
  // own resolver has to. A null here means the row's layer was never
  // resolved, which no reload can honour.
  const resolve = id => {
    if (api && api.findLayer) {
      try {
        const layer = api.findLayer(id);
        if (layer) return !!map.hasLayer(layer);
      } catch {
        // fall through to the direct lookups
      }
    }
    const direct = (map && map._layers && map._layers[id]) || window[id] || null;
    return direct && map ? !!map.hasLayer(direct) : null;
  };
  const out = [];
  rows.forEach(row => {
    const id = row.getAttribute("data-layer-id");
    const cb = row.querySelector('input[type="checkbox"]');
    const info = api && api.layers ? api.layers.find(l => l.id === id) : null;
    out.push({
      id,
      checked: cb ? cb.checked : null,
      visible: info ? info.visible : null,
      onMap: resolve(id),
    });
  });
  // Registry entries must back every rendered row -- otherwise the row state
  // has no source of truth and this test cannot say whether the reload
  // honoured the persisted hidden set. Throwing rather than returning a flag:
  // every consumer of this fixture wants the same answer, and an opaque
  // assertion elsewhere would be harder to read than the ids here.
  const missing = out.filter(r => r.visible === null).map(r => r.id);
  if (missing.length) {
    throw new Error(
      `registry has no entry for ${missing.length} rendered row(s): ${missing.join(", ")}`,
    );
  }
  return {
    rows: out,
    // How many layers the registry thinks exist -- one per rendered row, and
    // the count column and row list must never disagree.
    registry:
      api && api.layers ? api.layers.map(l => ({ id: l.id, name: l.name })) : null,
    // Layers the map thinks it holds, by stamp -- the registry id never appears
    // in here, so this is what decides whether a "hidden" layer is actually off
    // the map.
    mapCount: map ? Object.keys(map._layers).length : null,
    storage: Object.keys(localStorage)
      .filter(k => k.includes("foliplus"))
      .reduce((a, k) => ((a[k] = localStorage.getItem(k)), a), {}),
  };
};
