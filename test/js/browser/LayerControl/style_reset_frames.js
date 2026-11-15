// Samples the style panel's rect and inline/computed placement on every frame
// across a Reset, to catch a transient unpin/reposition.
arg => {
  const panel = () => document.querySelector(".foliplus-layer-style-panel");
  const snap = () => {
    const el = panel();
    const box = el?.getBoundingClientRect();
    return {
      top: box ? Math.round(box.top) : null,
      left: box ? Math.round(box.left) : null,
      height: box ? Math.round(box.height) : null,
      inlineTop: el ? el.style.top : null,
      computedTop: el ? getComputedStyle(el).top : null,
      transform: el ? getComputedStyle(el).transform : null,
      scrollY: window.scrollY,
    };
  };
  if (arg === "start") {
    window.__styleResetFrames = [];
    const before = snap();
    const tick = () => {
      window.__styleResetFrames.push(snap());
      if (window.__styleResetFrames.length < 12) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return before;
  }
  return window.__styleResetFrames;
};
