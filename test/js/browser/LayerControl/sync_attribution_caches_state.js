() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  let updateCalls = 0;
  const attrCtrl = api.map.attributionControl;
  if (!attrCtrl) return { error: "no attrCtrl" };
  const origUpdate = attrCtrl._update;
  attrCtrl._update = function () {
    updateCalls++;
    return origUpdate.call(this);
  };
  // Two consecutive enforceOrder with unchanged attribution
  api.enforceOrder();
  const afterFirst = updateCalls;
  api.enforceOrder();
  const afterSecond = updateCalls;
  attrCtrl._update = origUpdate;
  return { afterFirst, afterSecond, delta: afterSecond - afterFirst };
};
