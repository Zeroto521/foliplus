// removeControl → addControl must restart the initial layer scan (initScan
// lives in buildDOM now). The test then waits for [data-ready] on the
// re-created control — which only appears if the scan re-ran successfully.
() => {
  const ctrl = window.__heatmapCtrl;
  if (!ctrl) throw new Error("__heatmapCtrl not exposed");
  window.map.removeControl(ctrl);
  const removed = document.querySelector(".foliplus-heatmap-ctrl") === null;
  window.map.addControl(ctrl);
  return { removed, hasManager: !!ctrl.m };
};
