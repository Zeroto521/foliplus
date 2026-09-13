// removeControl → addControl on the same control object must rebuild the
// manager (lazy re-create) and re-bind the toolbar, not reuse a destroyed one.
() => {
  const ctrl = window.__measureCtrl;
  if (!ctrl) throw new Error("__measureCtrl not exposed");
  window.map.removeControl(ctrl);
  const removed = document.querySelector(".foliplus-measure-ctrl") === null;
  window.map.addControl(ctrl);
  const mgr = ctrl.m;
  const btnCount = document.querySelectorAll(
    ".foliplus-measure-ctrl .foliplus-tool-btn",
  ).length;
  return { removed, hasManager: !!mgr, btnCount };
};
