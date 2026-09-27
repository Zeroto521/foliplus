() => {
  const records = window.__inputGate ? window.__inputGate.records : null;
  const row = document.querySelector('.foliplus-layer-item[data-layer-id="ng_gate"]');
  const cb = row ? row.querySelector('input[type="checkbox"]') : null;
  return {
    records,
    cbAfter: cb ? cb.checked : null,
    rowFocused: !!document.querySelector(".foliplus-is-focused-row"),
    focusedTag: document.activeElement.tagName.toLowerCase(),
    focusedType: document.activeElement.type,
  };
};
