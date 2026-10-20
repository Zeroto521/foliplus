() => {
  const ctrl = window.__layerCtrl;
  const map = ctrl.mgr.map;
  const ui = ctrl.mgr.ui;
  const api = map.foliplus.LayerAPI;

  const geo = L.geoJson({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "p1" },
        geometry: { type: "Point", coordinates: [119.3, 26.08] },
      },
    ],
  });
  api.registerLayer({ id: "zr_oor", name: "ZROOR", layer: geo });
  ctrl.mgr.enforceOrder();

  const current = map.getZoom();

  // Set a range that excludes the current zoom level.
  ui.openStylePanel("zr_oor");
  const row = document.querySelector(".foliplus-style-zoom-range-row");
  if (!row) {
    ui.closeStylePanel(false);
    return { error: "zoom range row not rendered" };
  }

  const host = row.querySelector(".foliplus-style-zoom-range-control");
  if (!host) {
    ui.closeStylePanel(false);
    return { error: "zoom range slider not found" };
  }
  const thumbs = host.querySelectorAll(".foliplus-slider-thumb");

  // Drag the max thumb down to current - 1 through the primitive's real
  // pointer path. The release commits it.
  const track = host.querySelector(".foliplus-slider-track");
  const lo = Number(thumbs[0].getAttribute("aria-valuemin"));
  const hi = Number(thumbs[thumbs.length - 1].getAttribute("aria-valuemax"));
  const target = current - 1;
  const fraction = hi === lo ? 0 : (target - lo) / (hi - lo);
  const rect = track.getBoundingClientRect();
  const x = rect.left + rect.width * Math.max(0, Math.min(1, fraction));
  const y = rect.top + rect.height / 2;
  const base = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: 18,
    pointerType: "mouse",
    button: 0,
  };
  thumbs[1].dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1 }));
  track.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));

  const rowOor = row.classList.contains("foliplus-zoom-range-out-of-range");
  const rowTitle = row.title;
  const trackBg = row.querySelector(".foliplus-slider-track");
  const fillBg = row.querySelector(".foliplus-slider-fill");
  const marker = row.querySelector(".foliplus-slider-dot-current");
  const markerLabel = row.querySelector(".foliplus-slider-value-current");
  const markerRing = marker ? getComputedStyle(marker).borderColor : null;
  const markerLabelText = markerLabel ? markerLabel.textContent : null;
  const currentValueColor = markerLabel ? getComputedStyle(markerLabel).color : null;
  const minLabel = row.querySelector(".foliplus-slider-value-min");
  const maxLabel = row.querySelector(".foliplus-slider-value-max");

  // Snapshot the computed styles BEFORE closing the panel: a detached element
  // reports an empty `backgroundColor`, and the return object is built after the
  // close below.
  const fillComputedBg = fillBg ? getComputedStyle(fillBg).backgroundColor : null;

  ui.closeStylePanel(false);
  return {
    current,
    rowOor,
    rowTitle,
    trackComputedBg: trackBg ? getComputedStyle(trackBg).backgroundColor : null,
    fillComputedBg,
    currentValueColor,
    markerRing,
    markerLabelText,
    minLabelText: minLabel ? minLabel.textContent : null,
    maxLabelText: maxLabel ? maxLabel.textContent : null,
  };
};
