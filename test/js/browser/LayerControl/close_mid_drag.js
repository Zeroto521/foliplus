async () => {
  const ctrl = window.__layerCtrl;
  const map = ctrl.mgr.map;
  const ui = ctrl.mgr.ui;
  const api = map.foliplus.LayerAPI;
  // The control starts folded; a row (and the panel anchored inside it) only
  // has layout once it is expanded.
  const control = document.querySelector(".foliplus-layer-ctrl");
  if (control && !control.classList.contains("foliplus-is-expanded")) {
    control.querySelector(".foliplus-toggle-btn")?.click();
    await new Promise(resolve => requestAnimationFrame(resolve));
  }

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
  api.registerLayer({ id: "zr_close", name: "ZRClose", layer: geo });
  ctrl.mgr.enforceOrder();
  // The order pass is debounced; wait for the row before opening its panel,
  // otherwise the panel is built before it has an anchor to lay out in.
  await new Promise(resolve => window.setTimeout(resolve, 120));

  ui.openStylePanel("zr_close");
  const host = document.querySelector(".foliplus-style-zoom-range-control");
  if (!host) {
    ui.closeStylePanel(false);
    return { error: "zoom range slider not found" };
  }
  const track = host.querySelector(".foliplus-slider-track");
  // The shared panel mounts hidden and is revealed on a frame; a zero-width
  // track would map every pointer x to the minimum, so wait for real layout.
  let rect = track.getBoundingClientRect();
  for (let i = 0; i < 30 && rect.width === 0; i += 1) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    rect = track.getBoundingClientRect();
  }
  const thumbs = host.querySelectorAll(".foliplus-slider-thumb");
  const valueOf = index => Number(thumbs[index].getAttribute("aria-valuenow"));

  const start = valueOf(1);
  const target = start - 2;
  const lo = Number(thumbs[0].getAttribute("aria-valuemin"));
  const hi = Number(thumbs[thumbs.length - 1].getAttribute("aria-valuemax"));
  const xOf = value => {
    const fraction = hi === lo ? 0 : (value - lo) / (hi - lo);
    return rect.left + rect.width * Math.max(0, Math.min(1, fraction));
  };
  const base = {
    bubbles: true,
    cancelable: true,
    clientY: rect.top + rect.height / 2,
    pointerId: 23,
    pointerType: "mouse",
    button: 0,
  };

  thumbs[1].dispatchEvent(
    new PointerEvent("pointerdown", { ...base, clientX: xOf(start), buttons: 1 }),
  );
  track.dispatchEvent(
    new PointerEvent("pointermove", { ...base, clientX: xOf(target), buttons: 1 }),
  );
  const afterMove = valueOf(1);
  const storedBeforeClose = ui.intentStore.get("zr_close", "zoomRange") ?? null;

  // Close while the drag is still live: the pointer has not been released.
  ui.closeStylePanel(false);
  const storedAfterClose = ui.intentStore.get("zr_close", "zoomRange") ?? null;
  const draggingLeft = document.querySelector(".is-dragging") !== null;

  // Release after the element is gone, as a browser would (capture is lost).
  track.dispatchEvent(
    new PointerEvent("pointerup", { ...base, clientX: xOf(target), buttons: 0 }),
  );

  return {
    xStart: xOf(start),
    xTarget: xOf(target),
    start,
    target,
    afterMove,
    storedBeforeClose,
    storedAfterClose,
    draggingLeft,
    panelGone: !document.querySelector(".foliplus-layer-style-panel"),
    valueAfterClose: valueOf(1),
    minAfterClose: valueOf(0),
  };
};
