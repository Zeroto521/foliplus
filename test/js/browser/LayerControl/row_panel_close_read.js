// Read the state after a native activation key was pressed on a row-panel
// close button: whether foliplus cancelled it, whether the panel closed, and
// whether the row's layer checkbox stayed put.
() => {
  const row = document.querySelector(".foliplus-layer-item[data-layer-type=overlay]");
  const cb = row ? row.querySelector('input[type="checkbox"]') : null;
  return {
    records: window.__closeKeyGate ? window.__closeKeyGate.records : null,
    attrsOpen: !!document.querySelector(".foliplus-layer-attrs-panel"),
    styleOpen: !!document.querySelector(".foliplus-layer-style-panel"),
    checkboxAfter: cb ? cb.checked : null,
    focusedTag: document.activeElement.tagName.toLowerCase(),
  };
};
