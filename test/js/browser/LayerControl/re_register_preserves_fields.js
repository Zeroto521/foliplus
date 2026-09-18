() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;

  const fg = L.featureGroup();
  const onT = () => {};
  api.registerLayer({
    id: "__keep__",
    name: "Keep Me",
    isBase: true,
    layer: fg,
    paneName: "customPane",
    iconSvg: '<svg viewBox="0 0 4 4"><rect width="2" height="2"/></svg>',
    onToggle: onT,
  });
  const before = api.layers.find(l => l.id === "__keep__");
  const beforeCb = {
    name: before.name,
    isBase: before.isBase,
    layerSame: before.layer === fg,
    paneName: before.paneName,
    iconSvg: before.iconSvg,
    hasOnToggle: before.onToggle === onT,
  };

  // Re-register with only the id — nothing else should change.
  api.registerLayer({ id: "__keep__" });
  const after = api.layers.find(l => l.id === "__keep__");
  const afterCb = {
    name: after.name,
    isBase: after.isBase,
    layerSame: after.layer === fg,
    paneName: after.paneName,
    iconSvg: after.iconSvg,
    hasOnToggle: after.onToggle === onT,
  };

  api.unregisterLayer("__keep__");
  return { before: beforeCb, after: afterCb };
};
