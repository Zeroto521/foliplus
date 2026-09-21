() => {
  // Set the heatmap canvas row's opacity through the panel's own slider, so
  // the write goes through the real user path: applyOpacityStateOne,
  // markOverride, saveState. Anchoring on the heatmap's own id keeps this
  // independent of row order.
  const row = document.querySelector(
    '.foliplus-layer-item:not([data-layer-type="base"])' +
      ':not(.foliplus-color-layer-item)[data-layer-id^="foliplus_heatmap"]',
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
  const range = document.querySelector(".foliplus-style-opacity-range");
  if (!range) return { error: "opacity slider not found", id };
  range.value = "35";
  range.dispatchEvent(new Event("input", { bubbles: true }));
  range.dispatchEvent(new Event("change", { bubbles: true }));
  return { id, value: Number(range.value) };
};
