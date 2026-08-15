() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const coll = api.layerRegistry;
  if (!coll) return { error: "no layerRegistry exposed" };

  const KEYS = [
    "name",
    "id",
    "visible",
    "isBase",
    "paneName",
    "iconSvg",
    "type",
    "layer",
    "canvas",
    "onToggle",
    "onZIndex",
  ];
  const out = { entries: [] };
  for (const li of coll) {
    const entry = {
      id: li.id,
      isBase: li.isBase,
      hasAllKeys: true,
      missing: [],
    };
    for (const k of KEYS)
      if (!(k in li)) {
        entry.hasAllKeys = false;
        entry.missing.push(k);
      }
    entry.typeNull = li.type === null;
    out.entries.push(entry);
  }
  return out;
};
