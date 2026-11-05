({ width, height }) => {
  const mapEl = document.querySelector(".foliplus-map, .leaflet-container");
  mapEl.style.width = width + "px";
  mapEl.style.height = height + "px";
  if (window.map && window.map.invalidateSize) window.map.invalidateSize();
};
