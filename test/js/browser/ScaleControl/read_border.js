() => {
  // Read the scale line's bottom border style (the horizontal rule).
  const el = document.querySelector(".leaflet-control-scale-line");
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    bottomWidth: cs.borderBottomWidth,
    bottomStyle: cs.borderBottomStyle,
    bottomColor: cs.borderBottomColor,
  };
};
