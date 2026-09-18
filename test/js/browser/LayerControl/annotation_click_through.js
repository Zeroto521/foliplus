() => {
  const canvas = document.querySelector(".foliplus-annotation-canvas");
  if (!canvas) return { canvas: false };
  const cs = getComputedStyle(canvas);
  const r = canvas.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return {
    canvas: true,
    pointerEvents: cs.pointerEvents,
    hitIsCanvas: hit === canvas,
    hitTag: hit ? hit.tagName : null,
  };
};
