// Reads the style-panel owner row's computed background + glow.
//
// The row is the first overlay-type item; the style panel (when open) is its
// DOM child. The probe drops any keyboard-focus cursor first: the focused
// branch of the Row-cursor recipe is deliberately NOT carved out (a keyboard
// cursor must not depend on the pointer), so a leftover .foliplus-is-focused-row
// would light the row independently of the hover carve-out this probe measures.
// jsdom cannot simulate :hover (the dynamic pseudo-class never matches), so
// page.hover() drives the real pointer in the browser.
() => {
  const row = document.querySelector('.foliplus-layer-item[data-layer-type="overlay"]');
  if (!row) return null;
  row.classList.remove("foliplus-is-focused-row");
  const active = document.activeElement;
  if (active && typeof active.blur === "function") active.blur();
  const cs = getComputedStyle(row);
  return {
    bg: cs.backgroundColor,
    glow: cs.boxShadow !== "none",
    hasPanel: !!row.querySelector(".foliplus-layer-style-panel"),
  };
};
