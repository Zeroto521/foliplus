// The fill detail's opacity row in every fill mode.
//
// The opacity row is the LAST row of the fill detail — after the scheme row,
// before the border mode row — in solid, value and original mode alike, and it
// occupies only the right-hand column of its row. jsdom computes no layout, so
// the "last row" assertion lives in the browser suite.
//
// In solid and value mode the row holds an editable number input. In original
// mode it holds the readonly box instead — the mode never grows a second
// opacity control.
arg => {
  const { fillMode } = arg ?? {};
  const fillSelect = document.querySelector(".foliplus-style-fill-mode-select");
  if (fillMode) {
    if (!fillSelect) return { error: "no-fill-mode-select" };
    if (!["original", "solid", "value"].includes(fillMode)) {
      return { error: "bad-fill-mode", fillMode };
    }
    fillSelect.value = fillMode;
    fillSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const drawer = document.querySelector(".foliplus-layer-style-panel");
  if (!drawer) return { error: "no-drawer" };
  const fillBlock = drawer.querySelector('[data-style-dim="fill"]');
  if (!fillBlock) return { error: "no-fill-block" };
  const rows = Array.from(fillBlock.querySelectorAll(".foliplus-form-row")).filter(
    row => row.offsetWidth > 0 || row.offsetHeight > 0,
  );
  const label = row => {
    const el = row.querySelector(".foliplus-form-label");
    return el ? (el.textContent ?? "").trim() : null;
  };
  const box = el => {
    const r = el.getBoundingClientRect();
    return {
      w: Math.round(r.width * 10) / 10,
      left: Math.round(r.left * 10) / 10,
      right: Math.round(r.right * 10) / 10,
    };
  };
  const last = rows.at(-1) ?? null;
  const opacityInput = last
    ? last.querySelector(
        ".foliplus-form-number-group .foliplus-style-fill-opacity-number",
      )
    : null;
  const opacityBox = last ? last.querySelector(".foliplus-style-fill-readonly") : null;
  const target = opacityInput ?? opacityBox;
  return {
    ok: true,
    fillMode: fillSelect ? fillSelect.value : null,
    rowCount: rows.length,
    rowLabels: rows.map(label),
    lastRowLabel: last ? label(last) : null,
    hasOpacityInput: opacityInput !== null,
    hasOpacityBox: opacityBox !== null,
    opacity: target ? box(target) : null,
    opacityText: target ? (target.textContent ?? "").trim() : null,
  };
};
