// Pan-bubble follow probe: while the middle segment is dragged, both thumbs
// show a live value bubble that follows the thumb every frame, and the pair
// clears on release. Two samples are taken across a continuous move, so a
// placement that only ran at the pan's start (instead of every frame) would
// show the same left in both samples and fail.
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
  api.registerLayer({ id: "pan_bubble", name: "PAN BUBBLE", layer: geo });
  ctrl.mgr.enforceOrder();

  ui.openStylePanel("pan_bubble");
  await new Promise(resolve => requestAnimationFrame(() => resolve(null)));

  const row = document.querySelector(".foliplus-style-zoom-range-row");
  if (!row) return { error: "zoom range row not rendered" };
  const host = row.querySelector(".foliplus-style-zoom-range-control");
  if (!host) return { error: "zoom range host not rendered" };
  const track = host.querySelector(".foliplus-slider-track");
  if (!track) return { error: "track not found" };
  const thumbs = [...host.querySelectorAll(".foliplus-slider-thumb")];
  if (thumbs.length !== 2) return { error: "expected 2 thumbs" };

  const rect = track.getBoundingClientRect();
  const lo = Number(thumbs[0].getAttribute("aria-valuemin"));
  const hi = Number(thumbs[0].getAttribute("aria-valuemax"));
  const xOf = value => {
    const frac = hi === lo ? 0 : (value - lo) / (hi - lo);
    return rect.left + rect.width * Math.max(0, Math.min(1, frac));
  };
  const live = () => [...document.querySelectorAll(".foliplus-slider-bubble.is-on")];

  const mid = (xOf(lo) + xOf(hi)) / 2;
  const base = {
    bubbles: true,
    cancelable: true,
    clientY: rect.top + rect.height / 2,
    pointerId: 21,
    pointerType: "mouse",
    button: 0,
  };
  track.dispatchEvent(
    new PointerEvent("pointerdown", { ...base, clientX: mid, buttons: 1 }),
  );

  const bubblesA = live();
  track.dispatchEvent(
    new PointerEvent("pointermove", { ...base, clientX: mid + 20, buttons: 1 }),
  );
  await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
  const bubblesB = live();
  const leftA = bubblesA.map(b => b.style.left);
  const leftB = bubblesB.map(b => b.style.left);
  track.dispatchEvent(
    new PointerEvent("pointerup", { ...base, clientX: mid + 20, buttons: 0 }),
  );
  const afterUp = live();

  ui.closeStylePanel(false);
  return {
    countA: bubblesA.length,
    countB: bubblesB.length,
    countAfterUp: afterUp.length,
    moved0: leftA[0] !== leftB[0],
    moved1: leftA[1] !== leftB[1],
    text0: bubblesB[0]?.textContent ?? null,
    text1: bubblesB[1]?.textContent ?? null,
    aria0: thumbs[0].getAttribute("aria-valuenow"),
    aria1: thumbs[1].getAttribute("aria-valuenow"),
  };
};
