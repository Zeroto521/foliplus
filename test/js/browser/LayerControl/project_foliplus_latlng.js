// Converts [26.1, 119.35] (Fuzhou centre) to page coordinates and returns
// them in viewport space (adds the map container's rect offset).
() => {
  const p = window.map.latLngToContainerPoint([26.1, 119.35]);
  const c = window.map.getContainer().getBoundingClientRect();
  return { x: c.left + p.x, y: c.top + p.y };
};
