// removeControl → addControl must rebuild the export manager and re-attach
// its UI (crop box + shortcuts rebind on the fresh instance).
() => {
  const ctrl = window.__exportCtrl;
  if (!ctrl) throw new Error("__exportCtrl not exposed");
  window.map.removeControl(ctrl);
  const removed = document.querySelector(".foliplus-export-ctrl") === null;
  window.map.addControl(ctrl);
  const mgr = ctrl.m;
  return {
    removed,
    hasManager: !!mgr,
    attached: !!(mgr && mgr.exportCtrl && mgr.exportToolBar),
  };
};
