() => [
  // Strip any build suffix (e.g. "1.0.0+build") so the assert can compare
  // against the pinned compatibility version directly.
  ((window.L && window.L.version) || "").split("+")[0],
  // The shared LayerAPI is the gate that all controls mount through.
  !!(window.map && window.map.foliplus && window.map.foliplus.LayerAPI),
];
