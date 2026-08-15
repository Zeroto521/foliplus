() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  let findIndexCalls = 0;
  const origFindIndex = Array.prototype.findIndex;
  Array.prototype.findIndex = function (fn) {
    findIndexCalls++;
    return origFindIndex.call(this, fn);
  };
  // Simulate a drag session: many dragover events between two
  // overlay layers (valid indices).
  for (let i = 0; i < 50; i++) api.canReorderBetween(0, 1);
  Array.prototype.findIndex = origFindIndex;
  return { findIndexCalls };
};
