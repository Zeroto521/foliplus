() => {
  const z = sel => {
    const el = document.querySelector(sel);
    return el ? parseInt(getComputedStyle(el).zIndex, 10) : null;
  };
  const dataPane = Array.from(document.querySelectorAll(".leaflet-pane")).find(p =>
    p.className.includes("foliplus-layer"),
  );
  return {
    markerPane: z(".leaflet-marker-pane"),
    dataPane: dataPane ? parseInt(getComputedStyle(dataPane).zIndex, 10) : null,
    popupPane: z(".leaflet-popup-pane"),
  };
};
