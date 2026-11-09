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
  // The fresh row starts at full extent, where the fill swallows the rail
  // (no pan region). Drag the lower thumb inward first to open a segment the
  // pan can grab.
  // Mirror the clamp probe's drag path: read the track rect fresh inside the
  // drag (the panel may still be settling when the row first mounts), press
  // on the thumb at its current value, and drive the move/up through the
  // track so the primitive's real pointer path runs.
  const driveThumb = (index, target) => {
    const track = host.querySelector(".foliplus-slider-track");
    const rect = track.getBoundingClientRect();
    const lo = Number(thumbs[0].getAttribute("aria-valuemin"));
    const hi = Number(thumbs[thumbs.length - 1].getAttribute("aria-valuemax"));
    const xOf = value => {
      const fraction = hi === lo ? 0 : (value - lo) / (hi - lo);
      return rect.left + rect.width * Math.max(0, Math.min(1, fraction));
    };
    const from = Number(thumbs[index].getAttribute("aria-valuenow"));
    const b = {
      bubbles: true,
      cancelable: true,
      clientY: rect.top + rect.height / 2,
      pointerId: 17,
      pointerType: "mouse",
      button: 0,
    };
    thumbs[index].dispatchEvent(
      new PointerEvent("pointerdown", { ...b, clientX: xOf(from), buttons: 1 }),
    );
    track.dispatchEvent(
      new PointerEvent("pointermove", { ...b, clientX: xOf(target), buttons: 1 }),
    );
    track.dispatchEvent(
      new PointerEvent("pointerup", { ...b, clientX: xOf(target), buttons: 0 }),
    );
    track.dispatchEvent(
      new PointerEvent("lostpointercapture", { ...b, clientX: xOf(target) }),
    );
  };
  // The fresh row spans the full extent, where the fill swallows the rail and
  // no pan segment exists. Open a gap on BOTH sides so the pair is not flush
  // with an edge; a flush pair clamps the very first pan step and the bubbles
  // would not move.
  driveThumb(0, Number(thumbs[0].getAttribute("aria-valuenow")) + 3);
  await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
  driveThumb(1, Number(thumbs[1].getAttribute("aria-valuenow")) - 3);
  await new Promise(resolve => requestAnimationFrame(() => resolve(null)));

  // The pan region is between the two thumbs; a press at the track's
  // geometric centre may fall outside it (thumb 0 can sit left of centre),
  // which would grab a thumb instead of panning the pair.
  const v0 = Number(thumbs[0].getAttribute("aria-valuenow"));
  const v1 = Number(thumbs[1].getAttribute("aria-valuenow"));
  const mid = (xOf(v0) + xOf(v1)) / 2;
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
  // Pan toward whichever side still has a gap: a pair flush with the min edge
  // clamps a left pan (and vice versa), which would leave the bubbles static
  // and fail the follow assertion.
  const dir = v0 > lo ? -1 : 1;
  const nextX = mid + dir * 20;
  track.dispatchEvent(
    new PointerEvent("pointermove", { ...base, clientX: nextX, buttons: 1 }),
  );
  await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
  const bubblesB = live();
  // Track each bubble by element identity: the pool re-parents a reused node,
  // so DOM order between the two samples is not stable.
  const leftA = new Map(bubblesA.map(b => [b, b.style.left]));
  const moved = bubblesA.map(b => {
    const stillLive = bubblesB.includes(b);
    return stillLive && leftA.get(b) !== b.style.left;
  });
  // Match each live bubble to the thumb it is centred on (nearest thumb x) so
  // the reported text is per thumb, not per DOM position.
  const textFor = value => {
    let best = null;
    let bestDist = Infinity;
    for (const b of bubblesB) {
      const bx = Number.parseFloat(b.style.left) + b.getBoundingClientRect().width / 2;
      const dist = Math.abs(bx - xOf(value));
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    return best ? best.textContent : null;
  };
  track.dispatchEvent(
    new PointerEvent("pointerup", { ...base, clientX: nextX, buttons: 0 }),
  );
  track.dispatchEvent(
    new PointerEvent("lostpointercapture", { ...base, clientX: nextX }),
  );
  const afterUp = live();

  ui.closeStylePanel(false);
  return {
    countA: bubblesA.length,
    countB: bubblesB.length,
    countAfterUp: afterUp.length,
    moved0: moved[0] ?? false,
    moved1: moved[1] ?? false,
    text0: textFor(v0),
    text1: textFor(v1),
    aria0: thumbs[0].getAttribute("aria-valuenow"),
    aria1: thumbs[1].getAttribute("aria-valuenow"),
  };
};
