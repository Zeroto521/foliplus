() => {
  // T253: component self-declared export DOM-copy opt-out (data attribute).
  //
  // - export control bar carries data-foliplus-export="exclude" (chrome);
  // - heatmap / createCanvas canvases are content — must NOT carry exclude
  //   (they paint via the li.canvas special path and must stay in the export).
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
