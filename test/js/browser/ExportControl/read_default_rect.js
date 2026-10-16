() => {
  const r = window.__exportManager.defaultRect();
  return { l: r.left, t: r.top, w: r.width, h: r.height };
};
