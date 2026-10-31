// Read the state after a native activation key was pressed on a style
// panel's Fill Color picker: whether foliplus cancelled it, whether the panel
// stayed open, and whether the owning row's checkbox moved.
() => {
  const probe = window.__colorProbe ?? {};
  const row = probe.layerId
    ? document.querySelector(
        `.foliplus-layer-item[data-layer-id="${CSS.escape(probe.layerId)}"]`,
      )
    : null;
  const cb = row ? row.querySelector('input[type="checkbox"]') : null;
  return {
    records: window.__colorKeyGate ? window.__colorKeyGate.records : null,
    styleOpen: !!document.querySelector(".foliplus-layer-style-panel"),
    checkboxAfter: cb ? cb.checked : null,
    focusedTag: document.activeElement.tagName.toLowerCase(),
  };
};
