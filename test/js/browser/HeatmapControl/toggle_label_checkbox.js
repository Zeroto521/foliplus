() => {
  const ctrl = window.__heatmapCtrl;
  if (!ctrl) return null;
  const before = ctrl.manager.currentLabelShow;
  const labelChk = ctrl.labelChk;
  if (labelChk) {
    labelChk.checked = !labelChk.checked;
    labelChk.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const after = ctrl.manager.currentLabelShow;
  return { labelChkExists: !!labelChk, before, after };
};
