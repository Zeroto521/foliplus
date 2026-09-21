// Gate: a foliplus pane's SVG renderer must not capture the map.
//
// An inline <svg> carrying pointer-events is hit over its WHOLE box, not only
// where it paints. Every foliplus pane holds one and each covers the map, so
// the topmost would take every event meant for a layer painted below it:
// geometry hover/click dies and the cursor sticks at the inherited `grab`.
//
// The user-visible contract this pins down:
//   - on the geometry, the path is the hit target and the cursor is `pointer`
//   - off the geometry, nothing inside the foliplus pane is the hit target
() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;

  const PANE = "__pane_svg_capture__";
  // GeoJSON coordinates are [longitude, latitude]. Small box around the map
  // centre ([26.08, 119.30]) so the container's far corner stays free.
  const geo = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [119.28, 26.06],
              [119.32, 26.06],
              [119.32, 26.1],
              [119.28, 26.1],
              [119.28, 26.06],
            ],
          ],
        },
      },
    ],
  };

  const mg = api.createLayers({
    id: "__pane_svg_capture_layers__",
    name: "PaneSvgCapture",
    panes: [{ name: PANE }],
  });
  let clicked = false;
  const gj = L.geoJSON(geo);
  gj.on("click", () => {
    clicked = true;
  });
  mg.mainLayer.addLayer(gj);
  if (window.__layerCtrl && window.__layerCtrl.m) {
    window.__layerCtrl.m.enforceOrder();
  }

  const pane = window.map.getPane(PANE);
  if (!pane) return { ready: false, reason: "no pane" };
  const svg = pane.querySelector("svg");
  const path = pane.querySelector("path.leaflet-interactive");
  if (!svg || !path) {
    return {
      ready: false,
      reason: "no svg or path in pane",
      hasSvg: Boolean(svg),
      hasPath: Boolean(path),
    };
  }

  const rect = window.map.getContainer().getBoundingClientRect();

  // On the geometry: the path's own painted centre.
  const bb = path.getBBox();
  const pt = svg.createSVGPoint();
  pt.x = bb.x + bb.width / 2;
  pt.y = bb.y + bb.height / 2;
  const onScreen = pt.matrixTransform(path.getScreenCTM());
  const onHit = document.elementFromPoint(onScreen.x, onScreen.y);
  if (onHit === path) {
    onHit.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: onScreen.x,
        clientY: onScreen.y,
      }),
    );
  }

  // Off the geometry: the container's far corner.
  const offX = rect.left + rect.width - 40;
  const offY = rect.top + rect.height - 40;
  const offHit = document.elementFromPoint(offX, offY);

  return {
    ready: true,
    panePointerEvents: getComputedStyle(pane).pointerEvents,
    svgPointerEvents: getComputedStyle(svg).pointerEvents,
    pathPointerEvents: getComputedStyle(path).pointerEvents,
    pathCursor: getComputedStyle(path).cursor,
    pathIsInteractive: path.classList.contains("leaflet-interactive"),
    onHitIsPath: onHit === path,
    onHitCursor: onHit ? getComputedStyle(onHit).cursor : null,
    clicked,
    offHitTag: offHit ? offHit.tagName : null,
    offHitIsSvg: offHit === svg,
    offHitInPane: pane.contains(offHit),
  };
};
