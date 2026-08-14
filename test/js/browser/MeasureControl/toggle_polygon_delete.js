() => {
  const mm = window.__measureManager;
  const map = window.__map;
  // Trigger toggle so delete icons are visible
  const poly = Object.values(mm.layers.mainLayer._layers || {}).find(
    l => l instanceof L.Polygon,
  );
  if (poly) poly.fire("click", { originalEvent: { target: poly._path } });
};
