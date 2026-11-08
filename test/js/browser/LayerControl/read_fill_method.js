// Read the fill-method select: the by-value mode states the declared
// classification as a value/label pair, so a caller can assert both the
// committed value and the visible label. Returns null when the element is
// absent (e.g. the panel is on another mode, or a reset dropped the drawer) —
// the caller must not assume an object.
() => {
  const s = document.querySelector(".foliplus-style-fill-method-select");
  return s ? { value: s.value, label: s.selectedOptions[0]?.text ?? null } : null;
};
