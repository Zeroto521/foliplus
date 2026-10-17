() =>
  Object.keys(localStorage).find(x => x.startsWith("foliplus_heatmap_")) === undefined;
