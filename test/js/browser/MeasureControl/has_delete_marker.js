() => {
  const mm = window.__measureManager;
  return Object.values(mm.layers.mainLayer._layers || {}).some(
    l =>
      l instanceof L.Marker &&
      l.options.icon?.options?.className?.includes("foliplus-del-icon"),
  );
};
