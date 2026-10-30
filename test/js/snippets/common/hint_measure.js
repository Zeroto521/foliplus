text => {
  map.foliplus.showHint("hint-width-test", text, 0);
  const el = document.querySelector(".foliplus-hint");
  if (!el) throw new Error("hint not rendered");
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const textNode = el.lastChild;
  const range = document.createRange();
  range.selectNodeContents(textNode);
  const lines = range.getClientRects().length;
  return {
    w: Math.round(r.width),
    h: Math.round(r.height),
    lines,
    overRight: r.right > window.innerWidth + 1,
    overLeft: r.left < -1,
    boxSizing: cs.boxSizing,
    maxW: cs.maxWidth,
  };
};
