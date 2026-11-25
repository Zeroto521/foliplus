() => {
  // Parse the heatmap's persisted config from localStorage (or null).
  const k = Object.keys(localStorage).find(x => x.startsWith("foliplus_heatmap_"));
  if (!k) return null;
  const parsed = JSON.parse(localStorage.getItem(k));
  return parsed && parsed.data ? parsed.data : parsed;
};
