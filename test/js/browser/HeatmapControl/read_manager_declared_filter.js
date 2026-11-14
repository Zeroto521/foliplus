() => {
  // The declared filter as the panel sees it: the model the filter row reads,
  // plus the aggregated cell values it produced.
  const m = window.__heatmapCtrl.mgr;
  const model = m.getFilterModel();
  return {
    filter: model ? model.filter : null,
    kept: model ? model.kept : null,
    total: model ? model.total : null,
    // The filter slot's ownership moved to the shared store: a declaration
    // seed never owns the slot (the user may still take it), while a
    // persisted user write does. `m.filtersTouched` no longer exists on the
    // Heatmap manager — it was only ever the MeasureControl's flag.
    touched: m.selectedLayerId
      ? m.filterStore.isOwned(m.layerId, m.selectedLayerId)
      : false,
    // One cell in this fixture (the h3 stub maps every point to ""), so the
    // sum is the whole visible evidence: the declared filter's kept points.
    values: (m.cachedFeatures || []).map(f => f.properties.value),
  };
};
