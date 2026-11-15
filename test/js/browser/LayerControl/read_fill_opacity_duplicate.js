// The fill opacity row's single-source contract (fill-opacity-modes spec).
//
// The fill opacity row belongs to the FILL channel alone. When both fill and
// border are in ORIGINAL mode (a per-feature author), the border reuses the
// fill's original detail for its column/colors/method readouts but must not
// re-emit a second opacity row — the duplicate-row bug the user saw. This
// probe counts opacity-labelled rows in both blocks and verifies the readout
// value is NOT truncated (the bare number + unit-suffix split, so '5' reads
// as 5% instead of a clipped '5…').
arg => {
  const { fillMode, borderMode } = arg ?? {};
  const fillSelect = document.querySelector(".foliplus-style-fill-mode-select");
  const borderSelect = document.querySelector(".foliplus-style-border-mode-select");
  if (fillMode) {
    if (!fillSelect) return { error: "no-fill-mode-select" };
    fillSelect.value = fillMode;
    fillSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (borderMode) {
    if (!borderSelect) return { error: "no-border-mode-select" };
    borderSelect.value = borderMode;
    borderSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const drawer = document.querySelector(".foliplus-layer-style-panel");
  if (!drawer) return { error: "no-drawer" };
  const fillBlock = drawer.querySelector('[data-style-dim="fill"]');
  const borderBlock = drawer.querySelector('[data-style-dim="border"]');
  if (!fillBlock || !borderBlock)
    return { error: "no-block", fill: !!fillBlock, border: !!borderBlock };
  // Opacity rows are the form rows whose label is the opacity string. Label via
  // the row's own form-label text (not the box aria-label, which carries the
  // unit suffix).
  const label = row => {
    const el = row.querySelector(".foliplus-form-label");
    return el ? (el.textContent ?? "").trim() : null;
  };
  const isOpacityRow = row => label(row) !== null && /opacity/i.test(label(row));
  const opacityRows = block =>
    Array.from(block.querySelectorAll(".foliplus-form-row")).filter(isOpacityRow);
  const fillRows = opacityRows(fillBlock);
  const borderRows = opacityRows(borderBlock);
  // The readout's truncation contract: the value span must not clip. Measure
  // the value span's scroll vs client width (a clipped value overflows its
  // box and scrollWidth > clientWidth). Also read the bare value text + the
  // unit suffix separately, so the test sees the split contract.
  const readout = rows => {
    if (!rows.length) return null;
    const box = rows[0].querySelector(".foliplus-style-fill-original-opacity");
    if (!box) return null;
    const value = box.querySelector(".foliplus-style-fill-original-value");
    const suffix = box.querySelector(".foliplus-form-number-suffix");
    return {
      valueText: value ? (value.textContent ?? "").trim() : null,
      suffixText: suffix ? (suffix.textContent ?? "").trim() : null,
      suffixHidden: suffix ? suffix.getAttribute("aria-hidden") : null,
      valueScrollW: value ? value.scrollWidth : null,
      valueClientW: value ? value.clientWidth : null,
      boxScrollW: box ? box.scrollWidth : null,
      boxClientW: box ? box.clientWidth : null,
    };
  };
  return {
    ok: true,
    fillMode: fillSelect ? fillSelect.value : null,
    borderMode: borderSelect ? borderSelect.value : null,
    fillOpacityRowCount: fillRows.length,
    borderOpacityRowCount: borderRows.length,
    fillOpacityRows: fillRows.map(label),
    borderOpacityRows: borderRows.map(label),
    fillReadout: readout(fillRows),
    borderReadout: readout(borderRows),
  };
};
