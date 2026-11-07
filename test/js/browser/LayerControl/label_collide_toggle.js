doFlip => {
  const ctrl = window.__layerCtrl;
  const ui = ctrl && ctrl.mgr;
  const mgr = ui && ui.annotation;
  if (!mgr) return null;
  const rows = [...document.querySelectorAll(".foliplus-layer-item[data-layer-id]")];
  const row = rows.find(r => (r.textContent || "").includes("Declared Collide"));
  if (!row)
    return {
      error: "row not found",
      names: rows.map(r => (r.textContent || "").trim()),
    };
  const id = row.getAttribute("data-layer-id");
  const raf = () =>
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const canvas = () => document.querySelector(".foliplus-label-canvas");
  const opaque = () => {
    const el = canvas();
    if (!el) return 0;
    const data = el.getContext("2d").getImageData(0, 0, el.width, el.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  };

  // Open the layer's style panel — that is where the "Avoid overlap" toggle lives.
  const layerUi = ui.ui || ui;
  layerUi.openStylePanel(id);
  const toggle = document.querySelector(".foliplus-style-collide-input");
  if (!toggle) return { error: "collide toggle not in the style panel" };

  return (async () => {
    await raf();
    const declared = {
      cfg: mgr.getConfig(id),
      checked: toggle.checked,
      opaque: opaque(),
    };

    if (!doFlip) return { id, declared };

    // Flip it like a user: the panel's change handler applies the patch.
    toggle.checked = !toggle.checked;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await raf();
    const flipped = {
      cfg: mgr.getConfig(id),
      checked: toggle.checked,
      opaque: opaque(),
    };

    let stored = null;
    try {
      layerUi.saveState();
      const persistence = layerUi.c && layerUi.c.persistence;
      if (persistence && persistence.flushAll) persistence.flushAll();
      for (const key of Object.keys(localStorage)) {
        const raw = localStorage.getItem(key);
        if (raw && raw.includes("collide")) stored = raw;
      }
    } catch (e) {
      stored = String(e);
    }
    return { id, declared, flipped, stored };
  })();
};
