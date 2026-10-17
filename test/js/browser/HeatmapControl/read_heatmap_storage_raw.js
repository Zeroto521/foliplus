() => {
  // Find the heatmap's localStorage key and return its raw value (or null).
  const k = Object.keys(localStorage).find(x => x.startsWith("foliplus_heatmap_"));
  return k ? localStorage.getItem(k) : null;
};
