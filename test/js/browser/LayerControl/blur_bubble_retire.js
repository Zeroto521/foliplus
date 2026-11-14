// Blur-retire probe: a slider drag that never gets a pointerup, then the
// window loses focus (the alt-tab / tab-switch case). The acceptance is that
// the value bubble and the drag state are gone, and that becoming visible
// again does not bring the bubble back.
async data => {
  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "no __layerCtrl" };
  const ui = ctrl.mgr.ui;
  const api = ctrl.mgr.map.foliplus.LayerAPI;
  const control = document.querySelector(".foliplus-layer-ctrl");
  if (control && !control.classList.contains("foliplus-is-expanded")) {
    control.querySelector(".foliplus-toggle-btn")?.click();
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  const geo = L.geoJson(data);
  api.registerLayer({ id: "blur_bubble", name: "BLUR BUBBLE", layer: geo });
  ctrl.mgr.enforceOrder();
  await new Promise(resolve => window.setTimeout(resolve, 120));

  ui.openStylePanel("blur_bubble");
  // Wait for real layout: a zero-width track maps every x to the minimum and
  // the drag would silently do nothing.
  let track = null;
  for (let i = 0; i < 30; i += 1) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const host = document.querySelector(".foliplus-style-opacity-slider");
    track = host?.querySelector(".foliplus-slider-track") ?? null;
    if (track && track.getBoundingClientRect().width > 0) break;
  }
  if (!track) {
    ui.closeStylePanel(false);
    return { error: "opacity slider not found" };
  }
  const host = track.closest(".foliplus-slider");
  const thumb = host.querySelector(".foliplus-slider-thumb");
  const rect = track.getBoundingClientRect();
  const lo = Number(thumb.getAttribute("aria-valuemin"));
  const hi = Number(thumb.getAttribute("aria-valuemax"));
  const xOf = value => {
    const fraction = hi === lo ? 0 : (value - lo) / (hi - lo);
    return rect.left + rect.width * Math.max(0, Math.min(1, fraction));
  };
  const live = () => [...document.querySelectorAll(".foliplus-slider-bubble.is-on")];
  const nodes = () => [...document.querySelectorAll(".foliplus-slider-bubble")];
  const dragging = () => host.querySelector(".is-dragging") !== null;
  const settle = () => new Promise(resolve => window.setTimeout(resolve, 260));

  const start = Number(thumb.getAttribute("aria-valuenow"));
  const target = Math.max(lo, start - 13);
  const base = {
    bubbles: true,
    cancelable: true,
    clientY: rect.top + rect.height / 2,
    pointerId: 31,
    pointerType: "mouse",
    button: 0,
  };
  // Press and move, then never release: the browser is about to lose focus.
  thumb.dispatchEvent(
    new PointerEvent("pointerdown", { ...base, clientX: xOf(start), buttons: 1 }),
  );
  track.dispatchEvent(
    new PointerEvent("pointermove", { ...base, clientX: xOf(target), buttons: 1 }),
  );
  const liveBefore = live().length;
  const draggingBefore = dragging();
  const textBefore = live()[0]?.textContent ?? null;

  // The interruption: window blur (what an alt-tab delivers).
  window.dispatchEvent(new Event("blur"));
  const liveAfterBlur = live().length;
  const draggingAfterBlur = dragging();
  await settle();
  const nodesAfterBlur = nodes().length;

  // Coming back must not revive the readout, and the row must still work.
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("scroll"));
  await settle();
  const nodesAfterReturn = nodes().length;

  // A later press still drives the control: the stale session is gone.
  const resumeFrom = Number(thumb.getAttribute("aria-valuenow"));
  thumb.dispatchEvent(
    new PointerEvent("pointerdown", { ...base, clientX: xOf(resumeFrom), buttons: 1 }),
  );
  track.dispatchEvent(
    new PointerEvent("pointermove", { ...base, clientX: xOf(lo), buttons: 1 }),
  );
  const resumed = Number(thumb.getAttribute("aria-valuenow")) === lo;
  track.dispatchEvent(
    new PointerEvent("pointerup", { ...base, clientX: xOf(lo), buttons: 0 }),
  );
  track.dispatchEvent(
    new PointerEvent("lostpointercapture", { ...base, clientX: xOf(lo) }),
  );
  await settle();
  const nodesAfterResume = nodes().length;

  ui.closeStylePanel(false);
  return {
    liveBefore,
    draggingBefore,
    textBefore,
    liveAfterBlur,
    draggingAfterBlur,
    nodesAfterBlur,
    nodesAfterReturn,
    resumed,
    nodesAfterResume,
    target,
  };
};
