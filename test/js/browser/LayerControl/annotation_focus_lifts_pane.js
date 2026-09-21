() => {
  const ctrl = window.__layerCtrl;
  const mgr = ctrl && ctrl.m.annotation;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!mgr || !api) return null;

  const build = (id, points) => {
    const g = api.createLayers({
      id,
      name: id,
      panes: [{ name: id + "_pane" }],
    });
    for (const [lat, lng, text] of points) {
      // L.circle — has both getLatLng (point-anchored label) and getBounds
      // (focus needs an extent; plain markers and circleMarkers lack it).
      const m = L.circle([lat, lng], { radius: 200 });
      m.feature = { properties: { name: text } };
      g.mainLayer.addLayer(m);
    }
    mgr.setConfig(id, { show: true, field: "name", format: "auto" });
    mgr.renderLabels(id);
  };
  build("__fa__", [
    [26.08, 119.3, "alpha"],
    [26.09, 119.31, "beta"],
  ]);
  build("__fb__", [
    [26.1, 119.32, "gamma"],
    [26.11, 119.33, "delta"],
  ]);
  ctrl.m.enforceOrder();

  // Pane names come from the Leaflet _panes registry, not the DOM id —
  // createPane does not set element.id, so read through map.getPane.
  const zOf = id => {
    const pane = window.map.getPane("foliplus-annotation-" + id);
    return pane ? parseInt(pane.style.zIndex) || 0 : null;
  };
  const opaqueOf = id => {
    const canvas = window.map
      .getPane("foliplus-annotation-" + id)
      ?.querySelector("canvas");
    if (!canvas) return 0;
    const data = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  };

  return new Promise(resolve => {
    requestAnimationFrame(() => {
      const before = { annA: zOf("__fa__"), annB: zOf("__fb__") };
      // Focus layer A via double-click on its panel row — the documented entry.
      const item = Array.from(
        document.querySelectorAll(
          ".foliplus-layer-item:not(.foliplus-color-layer-item)",
        ),
      ).find(el => el.getAttribute("data-layer-id") === "__fa__");
      if (!item) return resolve({ row: false });
      item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          resolve({
            row: true,
            before,
            after: { annA: zOf("__fa__"), annB: zOf("__fb__") },
            // Focus spotlights one layer: only its labels are planned/drawn.
            opaqueA: opaqueOf("__fa__"),
            opaqueB: opaqueOf("__fb__"),
          });
        }),
      );
    });
  });
};
