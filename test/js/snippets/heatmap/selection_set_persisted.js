() => {
  const m = window.__heatmapCtrl.mgr;
  const other = m.pointLayers.find(p => p.name === "Points 2");
  const key = "foliplus_heatmap_" + m.map.getContainer().id;
  localStorage.setItem(key, JSON.stringify({ layerId: other.id, field: "val" }));
  return { id: other.id, key };
};
