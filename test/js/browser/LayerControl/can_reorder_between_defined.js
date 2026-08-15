() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return false;
  return typeof api.canReorderBetween === "function";
};
