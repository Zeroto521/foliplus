() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  // Find the second layer (B) and bring it to front
  const idxB = api.layers.findIndex(l => l.name === "B");
  if (idxB <= 0) return null;
  const idB = api.layers[idxB].id;
  api.bringLayerToFront(idB);
  // After bringLayerToFront, B should be at index 0
  const newIdx = api.layers.findIndex(l => l.name === "B");
  return { initialIdx: idxB, newIdx };
};
