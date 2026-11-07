() => {
  const ctrl = window.__layerCtrl;
  const ui = ctrl && ctrl.mgr;
  const mgr = ui && ui.annotation;
  if (!mgr) return null;
  const rows = [...document.querySelectorAll(".foliplus-layer-item[data-layer-id]")];
  const row = rows.find(r => (r.textContent || "").includes("Declared Style"));
  if (!row) return { error: "row not found" };
  const id = row.getAttribute("data-layer-id");
  const cfg = mgr.getConfig(id);
  const canvas = document.querySelector(".foliplus-label-canvas");
  let green = 0;
  let blue = 0;
  if (canvas) {
    const data = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (g > 150 && g > r + 60 && g > b + 60) green++;
      if (b > 150 && b > r + 60 && b > g + 60) blue++;
    }
  }
  return { id, cfg, green, blue, hasConfig: mgr.hasConfig(id) };
};
