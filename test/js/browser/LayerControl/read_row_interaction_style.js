// Reads the interaction paint of a row: surface, glow, left bar, outline and
// the fold chevron colour. Addressed by selector so the same probe measures a
// role header, a folder row and a plain layer row.
//
// Read AFTER the state settles: the fold chevron carries a colour transition,
// so an immediate read returns an interpolated value instead of the state's
// final paint.
selector => {
  const row = document.querySelector(selector);
  if (!row) return null;
  const cs = getComputedStyle(row);
  const fold = row.querySelector(".foliplus-layer-fold-btn");
  const more = row.querySelector(".foliplus-layer-more-btn");
  return {
    background: cs.backgroundColor,
    glow: cs.boxShadow,
    leftBar: cs.borderLeftColor,
    outline: cs.outlineStyle,
    foldColor: fold ? getComputedStyle(fold).color : null,
    moreColor: more ? getComputedStyle(more).color : null,
    active: row.classList.contains("foliplus-active"),
    focused: row.classList.contains("foliplus-is-focused-row"),
    folded: row.classList.contains("foliplus-layer-folded"),
  };
};
