// The map container's viewport box — the coordinate space of the readout.
() => {
  const el = document.querySelector(".leaflet-container");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};
