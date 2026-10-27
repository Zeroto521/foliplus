() => {
  const mm = window.__measureManager;
  mm.setMode("clear");
  return mm.measurements.map(m => m.type);
};
