// Shared helpers for the ui-tier tests.
//
// The dropdown and the listbox both drive a panel-shaped form cell (the native
// select the panels render), so the shape lives here instead of being copied
// into each engine's contract suite.
/** A panel-shaped form cell with the native select the panels render. */
const makeCell = (
  value: string,
  options: readonly { value: string; label: string; disabled?: boolean }[],
): { select: HTMLSelectElement; cell: HTMLElement } => {
  const cell = document.createElement("div");
  cell.className = "foliplus-form-control";
  const select = document.createElement("select");
  select.className = "foliplus-form-select";
  select.setAttribute("aria-label", "Pick a thing");
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    if (option.disabled) el.disabled = true;
    select.appendChild(el);
  }
  select.value = value;
  cell.appendChild(select);
  document.body.appendChild(cell);
  return { select, cell };
};

export { makeCell };
