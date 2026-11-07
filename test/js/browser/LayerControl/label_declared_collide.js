coords => {
  const ctrl = window.__layerCtrl;
  const ui = ctrl && ctrl.mgr;
  const mgr = ui && ui.annotation;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!mgr || !api) return null;
  const rows = [...document.querySelectorAll(".foliplus-layer-item[data-layer-id]")];
  const row = rows.find(r => (r.textContent || "").includes("Declared Collide"));
  if (!row)
    return {
      error: "row not found",
      names: rows.map(r => (r.textContent || "").trim()),
    };
  const id = row.getAttribute("data-layer-id");
  const canvas = document.querySelector(".foliplus-label-canvas");
  if (!canvas) return { error: "no annotation canvas" };
  const ctx = canvas.getContext("2d");
  const raf = () =>
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const opaque = () => {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  };

  return (async () => {
    await raf();
    // renderLabels returns the labels it planned — the collision decision.
    const declaredLabels = mgr.renderLabels(id).length;
    await raf();
    const declared = {
      cfg: mgr.getConfig(id),
      labels: declaredLabels,
      opaque: opaque(),
    };

    mgr.setConfig(id, { ...declared.cfg, collide: true });
    const collidedLabels = mgr.renderLabels(id).length;
    await raf();
    const collided = {
      cfg: mgr.getConfig(id),
      labels: collidedLabels,
      opaque: opaque(),
    };

    mgr.clearConfig(id);
    mgr.renderLabels(id);
    await raf();
    return { id, declared, collided };
  })();
};
