() => {
  const map = window.map;
  const ctrl = window.__layerCtrl;
  if (!map || !ctrl) return { error: "missing map or ctrl" };

  const ui = ctrl.m.ui;
  if (!ui.focusMask) return { error: "focusMask not drawn" };

  // The outer ring is the mask polygon's first sub-ring: the "everything
  // outside the hole" boundary. For the mask to dim the entire viewport,
  // its lat/lng extremes must enclose the current viewport — otherwise the
  // pre-fitBounds viewport ring leaks bright strips around a zoomed-out view.
  const outer = ui.focusMask.getLatLngs()[0];
  const toLatLng = p => (p.lat != null ? p : L.latLng(p));
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const p of outer) {
    const ll = toLatLng(p);
    if (ll.lat < minLat) minLat = ll.lat;
    if (ll.lat > maxLat) maxLat = ll.lat;
    if (ll.lng < minLng) minLng = ll.lng;
    if (ll.lng > maxLng) maxLng = ll.lng;
  }

  const view = map.getBounds();
  const vw = view.getWest(),
    ve = view.getEast(),
    vs = view.getSouth(),
    vn = view.getNorth();
  // Web Mercator wraps lng at ±180; a ring spanning that full range covers
  // every viewport longitude.
  const wrapsLng = Math.abs(minLng) >= 180 || Math.abs(maxLng) >= 180;
  const coversLat = minLat <= vs && maxLat >= vn;
  const coversLng = wrapsLng || (minLng <= vw && maxLng >= ve);
  const coversViewport = coversLat && coversLng;

  // Mirror: does the viewport enclose the outer ring? After fitBounds zoom-
  // in, the outer ring shrinks inside the viewport — this is fine for
  // coverage but is a useful diagnostic when the outer ring is stale.
  const outerInsideViewport =
    minLat >= vs && maxLat <= vn && minLng >= vw && maxLng <= ve;

  return {
    outer: { minLat, maxLat, minLng, maxLng, wrapsLng },
    view: { west: vw, east: ve, south: vs, north: vn },
    zoom: map.getZoom(),
    coversLat,
    coversLng,
    coversViewport,
    outerInsideViewport,
  };
};
