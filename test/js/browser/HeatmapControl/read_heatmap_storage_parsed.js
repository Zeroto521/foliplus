() => {
  // Parse the heatmap's persisted config from localStorage (or null).
  const k = Object.keys(localStorage).find(x => x.startsWith("foliplus_heatmap_"));
  return k ? JSON.parse(localStorage.getItem(k)) : null;
};
