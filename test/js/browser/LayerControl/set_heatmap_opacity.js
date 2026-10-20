() => {
  // Set the heatmap canvas row's opacity through the panel's own slider, so
  // the write goes through the real user path: applyOpacityStateOne,
  // markOverride, saveState. Anchoring on the heatmap's own id keeps this
  // independent of row order.
  const row = document.querySelector(
    '.foliplus-layer-item:not([data-layer-type="base"])' +
      '[data-layer-id^="foliplus_heatmap"]',
  );
  if (!row) {
    return {
      error: "heatmap row not found",
      ids: Array.from(
        document.querySelectorAll(".foliplus-layer-item[data-layer-id]"),
      ).map(r => r.getAttribute("data-layer-id")),
    };
  }
  const id = row.getAttribute("data-layer-id");
  // ⋮ → Style, the same two clicks a user makes.
  row.querySelector(".foliplus-layer-more-btn").click();
  document
    .querySelector(
      `.foliplus-layer-item[data-layer-id="${id}"] li[data-action="style-layer"]`,
    )
    .click();
  const host = document.querySelector(".foliplus-style-opacity-track");
  if (!host) return { error: "opacity slider not found", id };
  // Pointerdown on the thumb + pointerup on the track: the primitive's real
  // drag path, including the release that commits.
  const track = host.querySelector(".foliplus-slider-track");
  const thumb = host.querySelector(".foliplus-slider-thumb");
  const rect = track.getBoundingClientRect();
  const x = rect.left + rect.width * 0.35;
  const y = rect.top + rect.height / 2;
  const base = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: 16,
    pointerType: "mouse",
    button: 0,
  };
  thumb.dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1 }));
  track.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
  return { id, value: Number(thumb.getAttribute("aria-valuenow")) };
};
