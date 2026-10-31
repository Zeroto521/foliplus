() => {
  const ctrl = window.__layerCtrl;
  const ui = ctrl && ctrl.mgr;
  const mgr = ui && ui.annotation;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!mgr || !api) return null;

  const rows = [...document.querySelectorAll(".foliplus-layer-item[data-layer-id]")];
  const row = rows.find(r => (r.textContent || "").includes("Declared Style"));
  if (!row)
    return {
      error: "row not found",
      names: rows.map(r => (r.textContent || "").trim()),
    };
  const id = row.getAttribute("data-layer-id");
  const canvas = document.querySelector(".foliplus-label-canvas");
  if (!canvas) return { error: "no annotation canvas" };
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const raf = () =>
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const read = () => {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let green = 0;
    let blue = 0;
    let minX = 1e9;
    let minY = 1e9;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (!data[i + 3]) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (g > 150 && g > r + 60 && g > b + 60) {
          green++;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
        if (b > 150 && b > r + 60 && b > g + 60) blue++;
      }
    }
    return {
      green,
      blue,
      bbox: green ? { w: (maxX - minX + 1) / dpr, h: (maxY - minY + 1) / dpr } : null,
    };
  };

  return (async () => {
    await raf();
    const declared = { cfg: mgr.getConfig(id), pixels: read() };

    mgr.setConfig(id, { ...declared.cfg, color: "#0000ff" });
    mgr.renderLabels(id);
    await raf();
    const overridden = { cfg: mgr.getConfig(id), pixels: read() };

    let storage = {};
    try {
      const layerUi = ui.ui || ui;
      layerUi.saveState();
      const persistence = layerUi.c && layerUi.c.persistence;
      if (persistence && persistence.flushAll) persistence.flushAll();
      for (const key of Object.keys(localStorage)) {
        storage[key] = localStorage.getItem(key);
      }
    } catch (e) {
      storage = { error: String(e) };
    }

    mgr.clearConfig(id);
    mgr.renderLabels(id);
    await raf();
    const afterReset = { cfg: mgr.getConfig(id), pixels: read() };

    mgr.setConfig(id, { ...afterReset.cfg, size: 10 });
    mgr.renderLabels(id);
    await raf();
    const smaller = { cfg: mgr.getConfig(id), pixels: read() };

    // And the other direction: a bigger declared size must paint a bigger box.
    mgr.setConfig(id, { ...afterReset.cfg, size: 30 });
    mgr.renderLabels(id);
    await raf();
    const larger = { cfg: mgr.getConfig(id), pixels: read() };

    mgr.clearConfig(id);
    mgr.renderLabels(id);
    await raf();

    return { id, dpr, declared, overridden, storage, afterReset, smaller, larger };
  })();
};
