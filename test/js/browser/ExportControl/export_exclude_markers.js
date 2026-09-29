() => {
  // Component self-declared export DOM-copy opt-out (T253).
  //
  // Asserts the export control bar carries foliplus-export-exclude, and that
  // a freshly createCanvas-built canvas self-marks the same class (detached
  // probe — not registered, so it cannot pollute the layer registry).
  const exportCtrl = document.querySelector(".foliplus-export-ctrl");
  let canvasMarked = false;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (api) {
    const probe = api.createCanvas({
      id: "__export_exclude_probe__",
      name: "Probe",
    });
    canvasMarked = probe.canvas.classList.contains("foliplus-export-exclude");
  }
  return {
    exportCtrlMarked: !!exportCtrl?.classList.contains("foliplus-export-exclude"),
    canvasMarked,
  };
};
