// removeControl → addControl must tear down the full LayerAPI (back to the
// lightweight stub) and then upgrade it again (fresh LayerManager), with the
// panel re-attached.
() => {
  const ctrl = window.__layerCtrl;
  if (!ctrl) throw new Error("__layerCtrl not exposed");
  window.map.removeControl(ctrl);
  const afterRemoveStub = window.map.foliplus.LayerAPI.isLayerControl === false;
  window.map.addControl(ctrl);
  return {
    afterRemoveStub,
    afterAddFull: window.map.foliplus.LayerAPI.isLayerControl === true,
    panelAttached: !!document.querySelector(".foliplus-panel-content"),
  };
}
