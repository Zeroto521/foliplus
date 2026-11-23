// Dump the first-frame paint of a Leaflet GeoJSON circle-marker layer plus the
// LayerControl panel's declared fill/border mode rows for that layer.
//
// Returns:
//   markers: [{ stroke, strokePresent, fill, fillPresent, strokeWidth }] — one
//     per path.leaflet-interactive, in DOM order, reading the Leaflet-set
//     stroke/fill/stroke-width ATTRIBUTES (what the vector actually paints).
//   distinctFills: how many unique fill values the markers carry.
//   panelFillModes: the fill-mode text shown on the layer's fill row.
//   panelBorderModes: the border-mode text shown on the layer's border row.
//   layerName: the panel row name this was matched against.
() => {
  const rows = [...document.querySelectorAll("path.leaflet-interactive")];
  const markers = rows.map((p) => {
    const stroke = p.getAttribute("stroke");
    const fill = p.getAttribute("fill");
    const strokeWidth = p.getAttribute("stroke-width");
    return {
      stroke: stroke,
      strokePresent: stroke !== null && stroke !== "" && stroke !== "none",
      fill: fill,
      fillPresent: fill !== null && fill !== "" && fill !== "none",
      strokeWidth: strokeWidth,
    };
  });
  const distinctFills = new Set(markers.map((m) => m.fill)).size;

  // Panel rows: the expanded list row carries the layer name; the style
  // sub-rows expose the resolved mode as text. Read whatever mode text the
  // fill/border cells render so the test can lock what the panel CLAIMS.
  const panelFillModes = [...document.querySelectorAll(
    ".foliplus-layer-ctrl [data-layer-dim=fill], .foliplus-layer-ctrl .foliplus-dim-fill",
  )].map((el) => (el.textContent || "").trim()).filter(Boolean);
  const panelBorderModes = [...document.querySelectorAll(
    ".foliplus-layer-ctrl [data-layer-dim=border], .foliplus-layer-ctrl .foliplus-dim-border",
  )].map((el) => (el.textContent || "").trim()).filter(Boolean);

  return {
    markers: markers,
    distinctFills: distinctFills,
    panelFillModes: panelFillModes,
    panelBorderModes: panelBorderModes,
    markerCount: markers.length,
  };
}
