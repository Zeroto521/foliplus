// Leaflet DOM adapter — the one Leaflet-touching helper that dom.ts used to
// carry. Kept out of common/ so the common layer stays DOM-pure.
// Cancel Leaflet's mapPane pan translation on an overlay canvas, so the canvas
// stays put in the container while its contents are drawn in container
// coordinates. The heatmap's and the annotation labels' canvases both ride
// inside mapPane (directly or via a child pane) and need this on every paint.
const cancelMapPaneTranslate = (canvas: HTMLCanvasElement, map: L.Map): void => {
  const mapPane = map.getPanes().mapPane;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mapPane may be null for non-standard CRS
  if (!mapPane) return;
  const pos = L.DomUtil.getPosition(mapPane);
  canvas.style.left = `${-pos.x}px`;
  canvas.style.top = `${-pos.y}px`;
};

export { cancelMapPaneTranslate };
