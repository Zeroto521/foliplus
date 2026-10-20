() => {
  const ctrl = window.__layerCtrl;
  const map = ctrl.mgr.map;
  const ui = ctrl.mgr.ui;
  const api = map.foliplus.LayerAPI;

  // Register a GeoJSON point layer — zoomRange capability = "pane".
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
  api.registerLayer({ id: "zr_clamp", name: "ZRClamp", layer: geo });
  ctrl.mgr.enforceOrder();

  ui.openStylePanel("zr_clamp");
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
  if (thumbs.length !== 2) {
    ui.closeStylePanel(false);
    return { error: "thumbs not found" };
  }

  const mapMin = map.getMinZoom();
  const mapMax = map.getMaxZoom();
  const initialMin = parseInt(thumbs[0].getAttribute("aria-valuenow"), 10);
  const initialMax = parseInt(thumbs[1].getAttribute("aria-valuenow"), 10);

  // Drag one thumb to `target` through the primitive's real pointer path.
  const driveThumb = (index, target) => {
    const track = host.querySelector(".foliplus-slider-track");
    const lo = Number(thumbs[0].getAttribute("aria-valuemin"));
    const hi = Number(thumbs[thumbs.length - 1].getAttribute("aria-valuemax"));
    const fraction = hi === lo ? 0 : (target - lo) / (hi - lo);
    const rect = track.getBoundingClientRect();
    const x = rect.left + rect.width * Math.max(0, Math.min(1, fraction));
    const y = rect.top + rect.height / 2;
    const base = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 17,
      pointerType: "mouse",
      button: 0,
    };
    thumbs[index].dispatchEvent(
      new PointerEvent("pointerdown", { ...base, buttons: 1 }),
    );
    track.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
  };

  const valueOf = index => parseInt(thumbs[index].getAttribute("aria-valuenow"), 10);

  // Drag min past max — the two thumbs never cross; the pair clamps together.
  const crossVal = initialMax + 1;
  driveThumb(0, crossVal);

  const minAfterCross = valueOf(0);
  const maxAfterCross = valueOf(1);

  // Reset: drag max back to the full range.
  driveThumb(1, mapMax);

  // Drag max below min — the pair clamps together again.
  driveThumb(1, initialMin - 1);

  const minAfterReverse = valueOf(0);
  const maxAfterReverse = valueOf(1);

  ui.closeStylePanel(false);
  return {
    mapMin,
    mapMax,
    initialMin,
    initialMax,
    crossVal,
    minAfterCross,
    maxAfterCross,
    minAfterReverse,
    maxAfterReverse,
    clampForward: minAfterCross <= maxAfterCross,
    clampReverse: minAfterReverse <= maxAfterReverse,
    stored: ui.intentStore.get("zr_clamp", "zoomRange") ?? null,
  };
};
