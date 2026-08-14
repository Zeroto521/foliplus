() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  const out = {};
  out.unknownOk = (() => {
    try {
      api.bringLayerToFront("nope");
      return true;
    } catch (e) {
      return false;
    }
  })();
  return out;
};
