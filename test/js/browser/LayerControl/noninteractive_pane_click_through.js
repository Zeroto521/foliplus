() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const DATA = "__ni_data_pane__";
  const LABEL = "__ni_label_pane__";
  const mg = api.createLayers({
    id: "__ni_pane__",
    name: "NonInteractivePane",
    panes: [{ name: DATA }, { name: LABEL, isLabel: true, interactive: false }],
  });
  const poly = L.polygon([
    [25.9, 119.1],
    [26.3, 119.1],
    [26.3, 119.5],
    [25.9, 119.5],
  ]);
  let polyClicked = false;
  poly.on("click", () => {
    polyClicked = true;
  });
  // Routes to the base pane: the data layer sits under the label pane.
  mg.mainLayer.addLayer(poly);
  // A label marker lives in the non-interactive label pane. The pane's
  // pointer-events: none must not swallow the marker's own click handler —
  // `pointer-events` is per-element and not inherited, so a descendant with
  // its own hit area stays a target. This mirrors MeasureControl's segment
  // labels, which keep label.on("click", openOverlay) while their pane is
  // declared non-interactive.
  let labelMarkerClicked = false;
  const labelMarker = L.marker([26.1, 119.3], {
    icon: L.divIcon({ className: "", html: "<b>t</b>", iconSize: [16, 16] }),
  });
  labelMarker.options.pane = LABEL;
  labelMarker.on("click", () => {
    labelMarkerClicked = true;
  });
  window.map.addLayer(labelMarker);
  const dataPane = window.map.getPane(DATA);
  const labelPane = window.map.getPane(LABEL);
  const path = poly.getElement();
  const markerIcon = labelMarker.getElement();
  if (!dataPane || !labelPane || !path || !markerIcon) {
    return {
      ready: false,
      dataPane: Boolean(dataPane),
      labelPane: Boolean(labelPane),
      hasPath: Boolean(path),
      hasMarker: Boolean(markerIcon),
    };
  }
  // A label canvas is one element covering the map. Without
  // pointer-events: none on its pane it would swallow every click meant for
  // the data layer underneath.
  const canvas = document.createElement("canvas");
  canvas.width = 4000;
  canvas.height = 4000;
  labelPane.appendChild(canvas);

  const container = window.map.getContainer().getBoundingClientRect();
  // Aim at a polygon point away from the marker (but still on-screen):
  // the polygon is the hit target, its click handler fires.
  const polyPoint = window.map.latLngToContainerPoint([26.15, 119.35]);
  const px = container.left + polyPoint.x;
  const py = container.top + polyPoint.y;
  const polyHit = document.elementFromPoint(px, py);
  if (polyHit) {
    polyHit.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: px, clientY: py }),
    );
  }
  // Aim at the marker (map center): its icon wrapper carries its own
  // pointer-events:auto, which re-enables it inside the pane's
  // pointer-events:none. The marker's click handler must fire — this is
  // the mechanism MeasureControl's segment labels rely on.
  const markerPoint = window.map.latLngToContainerPoint([26.1, 119.3]);
  const mx = container.left + markerPoint.x;
  const my = container.top + markerPoint.y;
  const markerHit = document.elementFromPoint(mx, my);
  if (markerHit) {
    markerHit.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: mx, clientY: my }),
    );
  }
  return {
    ready: true,
    polyPane: poly.options.pane,
    dataPointerEvents: getComputedStyle(dataPane).pointerEvents,
    labelPointerEvents: getComputedStyle(labelPane).pointerEvents,
    polyHitIsPoly: polyHit === path,
    polyHitInLabelPane: labelPane.contains(polyHit),
    polyHitTag: polyHit ? polyHit.tagName : null,
    markerHitIsIcon: markerHit === markerIcon,
    markerHitInLabelPane: labelPane.contains(markerHit),
    markerHitTag: markerHit ? markerHit.tagName : null,
    polyClicked,
    labelMarkerClicked,
  };
};
