type => {
  const mm = window.__measureManager;
  const item = mm.measurements.find(m => m.type === type);
  if (!item) return null;
  if (!item.id) item.id = mm.nextMeasurementId(item.type);
  mm.store.remove(item.id);
  mm.applyFilterVisibility();
  mm.store.emitCount();
  return mm.measurements.map(m => m.type);
};
