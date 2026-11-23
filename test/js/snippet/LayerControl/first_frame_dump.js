() => ({
  paths: Array.from(document.querySelectorAll("path.leaflet-interactive")).map(p => ({
    stroke: p.getAttribute("stroke"),
    fill: p.getAttribute("fill"),
    strokeW: p.getAttribute("stroke-width"),
    fillOp: p.getAttribute("fill-opacity"),
  })),
  borderMode:
    (document.querySelector("[data-style-dim='border'] select") || {}).value ?? null,
  fillMode:
    (document.querySelector("[data-style-dim='fill'] select") || {}).value ?? null,
});
