() => {
  // Check whether the map container carries the export-mode class.
  const c = document.querySelector(".leaflet-container");
  return c && c.classList.contains("foliplus-export-mode");
};
