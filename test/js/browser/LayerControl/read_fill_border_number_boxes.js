// Geometry parity of the fill and border number boxes (fill #1087 step 4).
//
// The fill opacity box and the border weight box must occupy the same flex slot
// and the same width in every mode combination, so the two rows read as one
// grid. jsdom computes no layout, so this lives in the browser suite.
//
// In SOLID mode the number slot is the number input itself. In ORIGINAL mode
// the slot is the readOnlyValue box (the input-skin wrapper), not the text span
// inside it — the wrapper carries the box width token.
arg => {
  const { fillMode, borderMode } = arg ?? {};
  const fillSelect = document.querySelector(".foliplus-style-fill-mode-select");
  const borderSelect = document.querySelector(".foliplus-style-border-mode-select");
  if (fillMode) {
    if (!fillSelect) return { error: "no-fill-mode-select" };
    if (!["original", "solid", "value"].includes(fillMode)) {
      return { error: "bad-fill-mode", fillMode };
    }
    fillSelect.value = fillMode;
    fillSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (borderMode) {
    if (!borderSelect) return { error: "no-border-mode-select" };
    if (!["original", "solid", "follow-fill"].includes(borderMode)) {
      return { error: "bad-border-mode", borderMode };
    }
    borderSelect.value = borderMode;
    borderSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const drawer = document.querySelector(".foliplus-layer-style-panel");
  if (!drawer) return { error: "no-drawer" };
  const fillBlock = drawer.querySelector('[data-style-dim="fill"]');
  const borderBlock = drawer.querySelector('[data-style-dim="border"]');
  if (!fillBlock || !borderBlock)
    return { error: "no-block", fill: !!fillBlock, border: !!borderBlock };
  const box = el => {
    const r = el.getBoundingClientRect();
    return {
      w: Math.round(r.width * 10) / 10,
      left: Math.round(r.left * 10) / 10,
      right: Math.round(r.right * 10) / 10,
    };
  };
  // The fill number slot: the opacity input in solid/value mode, the readOnlyValue
  // BOX in original mode (not the inner value span).
  const fillNumber =
    fillBlock.querySelector(".foliplus-style-fill-opacity-number") ??
    fillBlock.querySelector(".foliplus-style-fill-readonly") ??
    null;
  // The border number slot: the weight input, or the readOnlyValue box when the
  // border row is a read-only original.
  const borderNumber =
    borderBlock.querySelector(".foliplus-style-border-weight-input") ??
    borderBlock.querySelector(".foliplus-style-fill-readonly") ??
    null;
  const fillInline = fillBlock.querySelector(".foliplus-form-inline");
  const borderInline = borderBlock.querySelector(".foliplus-form-inline");
  return {
    ok: true,
    fillMode: fillSelect ? fillSelect.value : null,
    borderMode: borderSelect ? borderSelect.value : null,
    fillNumber: fillNumber ? box(fillNumber) : null,
    borderNumber: borderNumber ? box(borderNumber) : null,
    fillInline: fillInline ? box(fillInline) : null,
    borderInline: borderInline ? box(borderInline) : null,
  };
};
