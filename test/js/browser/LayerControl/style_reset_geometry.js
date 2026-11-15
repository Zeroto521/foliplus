// Records the style panel's geometry and scroll before a Reset and compares it
// after the in-place refresh. A reset keeps the panel open; it must not move
// the card or scroll the page/list.
phase => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const list = document.querySelector(".foliplus-layer-list");
  const snap = () => {
    const rect = panel ? panel.getBoundingClientRect() : null;
    return {
      top: rect ? Math.round(rect.top) : null,
      left: rect ? Math.round(rect.left) : null,
      height: rect ? Math.round(rect.height) : null,
      scrollY: window.scrollY,
      listScroll: list ? list.scrollTop : null,
    };
  };
  if (phase === "before") {
    window.__styleResetBefore = snap();
    return true;
  }
  const before = window.__styleResetBefore || {};
  const after = snap();
  return {
    sameTop: before.top === after.top,
    sameLeft: before.left === after.left,
    sameHeight: before.height === after.height,
    sameScrollY: before.scrollY === after.scrollY,
    sameListScroll: before.listScroll === after.listScroll,
    before,
    after,
  };
};
