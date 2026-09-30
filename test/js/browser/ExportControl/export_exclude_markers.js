() => {
  // T253: component self-declared export DOM-copy opt-out (data attribute).
  //
  // - export control bar carries data-foliplus-export="exclude" (self-mark);
  // - createCanvas factory stays neutral (no export vocabulary in core/layer);
  // - HeatmapControl stamps its own canvas after createCanvas (unit-tested
  //   in HeatmapControl/manager.test.ts).
  const exportCtrl = document.querySelector(".foliplus-export-ctrl");
  let createCanvasUnmarked = false;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (api) {
    const probe = api.createCanvas({
      id: "__export_exclude_probe__",
      name: "Probe",
    });
    createCanvasUnmarked = probe.canvas.getAttribute("data-foliplus-export") === null;
  }
  return {
    exportCtrlMarked: exportCtrl?.getAttribute("data-foliplus-export") === "exclude",
    createCanvasUnmarked,
  };
};
