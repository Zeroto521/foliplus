// Row-vs-map color fidelity probe for row-fidelity.
//
// Reads the style panel's icon-color row and marker-color row values and the
// real marker DOM paint, so a test can compare the row reading against what
// the map actually draws.
//
// Returns:
//   iconColorRow: { present, value }   — color input value (or null)
//   markerColorRow: { present, value } — native select value (or null)
//   marker: { cls, innerColor, innerCls, hasChassis } — first marker element
async () => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { panel: false };

  // Icon color row: a color input inside .foliplus-style-icon-color-row.
  const iconRow = panel.querySelector(".foliplus-style-icon-color-row");
  const colorInput = iconRow?.querySelector("input[type=color]");
  const iconColorRow = iconRow
    ? { present: true, value: colorInput ? colorInput.value : null }
    : { present: false, value: null };

  // Marker color row: a native select inside .foliplus-style-marker-color-row.
  const mcRow = panel.querySelector(".foliplus-style-marker-color-row");
  const select = mcRow?.querySelector("select");
  const markerColorRow = mcRow
    ? { present: true, value: select ? select.value : null }
    : { present: false, value: null };

  // First real marker element (awesome-markers chassis or default div icon).
  // The shadow also carries .awesome-marker, so pick the first candidate that
  // has an inner <i> (the real glyph carrier), never the shadow.
  const candidates = Array.from(
    document.querySelectorAll(
      ".awesome-marker, .foliplus-marker-default, .leaflet-marker-icon, .leaflet-div-icon",
    ),
  );
  const marker = candidates.find(el => el.querySelector("i")) ?? candidates[0] ?? null;
  let markerInfo = null;
  if (marker) {
    const inner = marker.querySelector("i");
    markerInfo = {
      cls: marker.className,
      hasChassis: /awesome-marker-icon-/.test(marker.className),
      innerCls: inner ? inner.className : null,
      innerColor: inner ? getComputedStyle(inner).color : null,
      html: marker.innerHTML,
    };
  }

  return { panel: true, iconColorRow, markerColorRow, marker: markerInfo };
};
