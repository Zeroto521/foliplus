() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  // Simulate a layeradd arriving while enforceOrder is running.
  // onLayerAdd must fall back to debouncedEnforce instead of
  // silently dropping the reorder.
  let rescheduled = 0;
  const origDebounced = api.debouncedEnforce;
  api.debouncedEnforce = function () {
    rescheduled++;
    return origDebounced.call(this);
  };
  api.isEnforcing = true; // simulate in-flight enforceOrder
  api.onLayerAdd({ layer: { options: { paneName: "test" } } });
  api.isEnforcing = false;
  api.debouncedEnforce = origDebounced;
  return { rescheduled };
};
