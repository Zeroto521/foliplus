() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  const check = () => {
    const ids = api.layers.map(l => l.id);
    const indexKeys = Array.from(api.layerRegistry.byId.keys());
    const sameSet =
      ids.length === indexKeys.length && ids.every(id => api.layerRegistry.has(id));
    // Index values must reference the same objects as the array
    const sameRefs = ids.every(
      id => api.layerRegistry.get(id) === api.layers.find(l => l.id === id),
    );
    return { sameSet, sameRefs };
  };

  // 1. Register several layers
  for (let i = 0; i < 3; i++) {
    api.registerLayer({
      id: "__idx_" + i + "__",
      name: "Idx" + i,
      layer: L.marker([26.08 + i * 0.01, 119.3]),
    });
  }
  const afterRegister = check();

  // 2. Unregister one
  api.unregisterLayer("__idx_1__");
  const afterUnregister = check();

  // 3. Reorder (bring to front)
  api.bringLayerToFront("__idx_2__");
  const afterReorder = check();

  // 4. findLayer / getLayerType via the index
  const found = api.findLayer("__idx_0__") != null;
  // L.marker has no .feature so geometry type is UNKNOWN — the
  // point here is that getLayerType resolves via the index at all
  // (non-null, no exception), not its exact value.
  const typeResolved = api.getLayerType("__idx_0__") != null;

  return {
    afterRegister,
    afterUnregister,
    afterReorder,
    found,
    typeResolved,
  };
};
