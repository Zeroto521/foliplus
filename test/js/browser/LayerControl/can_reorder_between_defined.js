() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return false;
  return typeof api.canReorderBetween === "function";
};
