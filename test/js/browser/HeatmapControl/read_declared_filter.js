() => {
  // The declared filter as the panel sees it: the model the filter row reads,
  // plus the aggregated cell values it produced.
  const m = window.__heatmapCtrl.mgr;
  const model = m.getFilterModel();
  return {
    filter: model ? model.filter : null,
    kept: model ? model.kept : null,
    total: model ? model.total : null,
    touched: m.filtersTouched,
    // One cell in this fixture (the h3 stub maps every point to ""), so the
    // sum is the whole visible evidence: the declared filter's kept points.
    values: (m.cachedFeatures || []).map(f => f.properties.value),
  };
};
