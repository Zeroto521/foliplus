() =>
  Array.from(document.querySelectorAll("path.leaflet-interactive"))
    .map(p => p.getAttribute("fill"))
    .filter(Boolean);
