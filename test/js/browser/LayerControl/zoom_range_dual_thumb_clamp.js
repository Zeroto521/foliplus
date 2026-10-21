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

  // One layer per direction: after a clamp the pair is stacked, so a second
  // direction from the same row would start on an already-merged range.
  const register = id => {
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
    api.registerLayer({ id, name: id.toUpperCase(), layer: geo });
    return geo;
  };
  register("zr_clamp_f");
  register("zr_clamp_r");
  ctrl.mgr.enforceOrder();

  const mapMin = map.getMinZoom();
  const mapMax = map.getMaxZoom();

  const rowFor = () => document.querySelector(".foliplus-style-zoom-range-row");
  const hostFor = () => {
    const row = rowFor();
    return row ? row.querySelector(".foliplus-style-zoom-range-control") : null;
  };

  // Drag one thumb through the primitive's real pointer path: press on the
  // thumb at its CURRENT value, move to the target, release. (Pressing at the
  // target would pick a thumb by side instead of grabbing the one asked for.)
  const driveThumb = (host, thumbs, index, target) => {
    const track = host.querySelector(".foliplus-slider-track");
    const lo = Number(thumbs[0].getAttribute("aria-valuemin"));
    const hi = Number(thumbs[thumbs.length - 1].getAttribute("aria-valuemax"));
    const rect = track.getBoundingClientRect();
    const xOf = value => {
      const fraction = hi === lo ? 0 : (value - lo) / (hi - lo);
      return rect.left + rect.width * Math.max(0, Math.min(1, fraction));
    };
    const from = Number(thumbs[index].getAttribute("aria-valuenow"));
    const base = {
      bubbles: true,
      cancelable: true,
      clientY: rect.top + rect.height / 2,
      pointerId: 17,
      pointerType: "mouse",
      button: 0,
    };
    thumbs[index].dispatchEvent(
      new PointerEvent("pointerdown", {
        ...base,
        clientX: xOf(from),
        buttons: 1,
      }),
    );
    track.dispatchEvent(
      new PointerEvent("pointermove", {
        ...base,
        clientX: xOf(target),
        buttons: 1,
      }),
    );
    track.dispatchEvent(
      new PointerEvent("pointerup", {
        ...base,
        clientX: xOf(target),
        buttons: 0,
      }),
    );
  };

  const valueOf = (thumbs, index) =>
    Number(thumbs[index].getAttribute("aria-valuenow"));

  // Forward: drag the lower thumb past the upper one. A row is laid out on
  // the frame after it mounts, so wait before reading any rect.
  ui.openStylePanel("zr_clamp_f");
  await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
  let host = hostFor();
  if (!host) {
    ui.closeStylePanel(false);
    return { error: "zoom range row not rendered" };
  }
  let thumbs = host.querySelectorAll(".foliplus-slider-thumb");
  if (thumbs.length !== 2) {
    ui.closeStylePanel(false);
    return { error: "thumbs not found" };
  }
  const initialMin = valueOf(thumbs, 0);
  const initialMax = valueOf(thumbs, 1);
  const crossVal = initialMax + 1;
  driveThumb(host, thumbs, 0, crossVal);
  const minAfterCross = valueOf(thumbs, 0);
  const maxAfterCross = valueOf(thumbs, 1);
  const storedForward = ui.intentStore.get("zr_clamp_f", "zoomRange") ?? null;
  ui.closeStylePanel(false);

  // Reverse: drag the upper thumb below the lower one.
  ui.openStylePanel("zr_clamp_r");
  await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
  host = hostFor();
  if (!host) return { error: "zoom range row not rendered (reverse)" };
  thumbs = host.querySelectorAll(".foliplus-slider-thumb");
  const reverseMin = valueOf(thumbs, 0);
  const reverseMax = valueOf(thumbs, 1);
  driveThumb(host, thumbs, 1, reverseMin - 1);
  const minAfterReverse = valueOf(thumbs, 0);
  const maxAfterReverse = valueOf(thumbs, 1);
  const storedReverse = ui.intentStore.get("zr_clamp_r", "zoomRange") ?? null;
  ui.closeStylePanel(false);

  return {
    mapMin,
    mapMax,
    initialMin,
    initialMax,
    crossVal,
    minAfterCross,
    maxAfterCross,
    reverseMin,
    reverseMax,
    minAfterReverse,
    maxAfterReverse,
    forwardMoved: minAfterCross !== initialMin,
    reverseMoved: maxAfterReverse !== reverseMax,
    clampForward: minAfterCross === maxAfterCross && maxAfterCross === initialMax,
    clampReverse: minAfterReverse === maxAfterReverse,
    storedForward,
    storedReverse,
  };
};
