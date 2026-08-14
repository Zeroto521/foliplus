() => {
  const mm = window.__measureManager;
  const map = window.__map;
  mm.setMode("circle");
  map.fire("click", { latlng: L.latLng(26.08, 119.3) }); // center → state 1
  map.invalidateSize();
  const node = () => document.querySelector(".foliplus-measure-node");

  // First mousemove: the radius node must be created here.
  map.fire("mousemove", { latlng: L.latLng(26.085, 119.305) });
  const r1 = node()?.getBoundingClientRect();

  // Second mousemove: the node must follow the cursor.
  map.fire("mousemove", { latlng: L.latLng(26.09, 119.31) });
  const r2 = node()?.getBoundingClientRect();

  return {
    x1: r1?.x ?? null,
    y1: r1?.y ?? null,
    x2: r2?.x ?? null,
    y2: r2?.y ?? null,
  };
};
