() => {
  const ctrl = window.__layerCtrl;
  const mgr = ctrl && ctrl.m.annotation;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!mgr || !api) return null;

  // Two labels on the same horizontal line, 20px apart, with a text long enough
  // that their estimated boxes overlap ≥75% of the narrower width — so the
  // second (same priority, same width → loses the index tie-break) must drop.
  const text = "12345678901234567890";
  const mk = pt => {
    const ll = window.map.containerPointToLatLng(L.point(pt.x, pt.y));
    const m = L.marker(ll);
    m.feature = { properties: { name: text } };
    return m;
  };
  const g = api.createLayers({
    id: "__ann_overlap__",
    name: "AnnOverlap",
    panes: [{ name: "__ann_overlap_pane__" }],
  });
  g.mainLayer.addLayer(mk({ x: 300, y: 200 }));
  g.mainLayer.addLayer(mk({ x: 320, y: 200 }));
  mgr.setConfig("__ann_overlap__", { show: true, field: "name", format: "auto" });
  mgr.renderLabels("__ann_overlap__");

  return new Promise(resolve => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const canvas = document.querySelector(".foliplus-annotation-canvas");
        if (!canvas) return resolve({ canvas: false });
        const dpr = window.devicePixelRatio || 1;
        const ctx = canvas.getContext("2d");
        // Point label: box top at anchor.y + 10, height 12 → text centre y =
        // anchor.y + 16. Count opaque pixels in two horizontal bands.
        const band = (x0, x1) => {
          let n = 0;
          const w = Math.round((x1 - x0) * dpr);
          for (let y = 210; y <= 222; y++) {
            const img = ctx.getImageData(
              Math.round(x0 * dpr),
              Math.round(y * dpr),
              w,
              1,
            ).data;
            for (let i = 3; i < img.length; i += 4) if (img[i] > 0) n++;
          }
          return n;
        };
        // First label's own extent (centre 300, ~144px wide → [228, 372]).
        const aOpaque = band(240, 300);
        // Second label's exclusive right edge (centre 320, right end ~392):
        // nothing here unless the second label was wrongly kept.
        const bOpaque = band(373, 390);
        resolve({ canvas: true, aOpaque, bOpaque });
      }),
    );
  });
};
