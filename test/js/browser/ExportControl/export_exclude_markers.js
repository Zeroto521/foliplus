() => {
  // T253: component self-declared export DOM-copy opt-out (data attribute).
  //
  // Asserts the export control bar carries data-foliplus-export="exclude",
  // and that a freshly createCanvas-built canvas self-marks the same
  // attribute (detached probe — not registered, so it cannot pollute the
  // layer registry).
  const exportCtrl = document.querySelector(".foliplus-export-ctrl");
  let canvasMarked = false;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (api) {
    const probe = api.createCanvas({
      id: "__export_exclude_probe__",
      name: "Probe",
    });
    canvasMarked = probe.canvas.getAttribute("data-foliplus-export") === "exclude";
  }
  return {
    exportCtrlMarked: exportCtrl?.getAttribute("data-foliplus-export") === "exclude",
    canvasMarked,
  };
};
