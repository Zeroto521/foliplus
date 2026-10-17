// The row that owns an open ⋮ menu — read its glow to confirm the owner
// stays lit while hovering it.
() => {
  const r = document.querySelector(
    ".foliplus-layer-item:has(.foliplus-layer-more-menu.open)",
  );
  return r ? getComputedStyle(r).boxShadow !== "none" : null;
};
