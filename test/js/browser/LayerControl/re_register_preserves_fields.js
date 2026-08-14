() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;

  const fg = L.featureGroup();
  const onT = () => {};
  const onZ = () => {};
  api.registerLayer({
    id: "__keep__",
    name: "Keep Me",
    isBase: true,
    layer: fg,
    paneName: "customPane",
    iconSvg: "<svg></svg>",
    onToggle: onT,
    onZIndex: onZ,
  });
  const before = api.layers.find(l => l.id === "__keep__");
  const beforeCb = {
    name: before.name,
    isBase: before.isBase,
    layerSame: before.layer === fg,
    paneName: before.paneName,
    iconSvg: before.iconSvg,
    hasOnToggle: before.onToggle === onT,
    hasOnZIndex: before.onZIndex === onZ,
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
    hasOnZIndex: after.onZIndex === onZ,
  };

  api.unregisterLayer("__keep__");
  return { before: beforeCb, after: afterCb };
};
