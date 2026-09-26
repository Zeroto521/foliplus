() => {
  // After the pane fix, "active" is on the color row, not the map container.
  // --color-layer-bg CSS var is no longer set; the color is in the pane.
  const row = document.querySelector(".foliplus-color-layer-item");
  if (!row) return null;
  const cb = row.querySelector('input[type="checkbox"]');
  const active = row.classList.contains("active");
  // Read the fill color from the pane's canvas context if available.
  const colorPane = Array.from(
    document.querySelectorAll(".leaflet-pane"),
  ).find(p => p.className.includes("foliplus-color-"));
  const colorFace = colorPane
    ? colorPane.querySelector(".foliplus-canvas-layer")
    : null;
  const colorVisible = colorFace && !colorFace.classList.contains("hidden");
  return {
    hasCheckbox: !!cb,
    checked: cb ? cb.checked : null,
    active,
    colorBg: active ? row.dataset.color || "present" : "",
    colorPaneFound: !!colorPane,
    colorVisible,
  };
};
