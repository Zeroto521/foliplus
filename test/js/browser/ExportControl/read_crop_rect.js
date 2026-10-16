() => {
  const r = window.__exportManager.cropState.rect;
  return { l: r.left, t: r.top, w: r.width, h: r.height };
};
