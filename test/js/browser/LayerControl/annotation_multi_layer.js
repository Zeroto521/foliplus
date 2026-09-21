() => {
  const ctrl = window.__layerCtrl;
  const mgr = ctrl && ctrl.m.annotation;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!mgr || !api) return null;

  const build = (id, name, points) => {
    const g = api.createLayers({
      id,
      name,
      panes: [{ name: id + "_pane" }],
    });
    for (const [lat, lng, text] of points) {
      const m = L.marker([lat, lng]);
      m.feature = { properties: { name: text } };
      g.mainLayer.addLayer(m);
    }
    mgr.setConfig(id, { show: true, field: "name", format: "auto" });
    mgr.renderLabels(id);
  };
  build("__ml_a__", "MLA", [
    [26.08, 119.3, "alpha"],
    [26.09, 119.31, "beta"],
  ]);
  build("__ml_b__", "MLB", [
    [26.1, 119.32, "gamma"],
    [26.11, 119.33, "delta"],
  ]);
  // enforceOrder is debounced; run it now so each layer's pane — and its
  // annotation pane — gets the z that places it in the stack.
  ctrl.m.enforceOrder();

  return new Promise(resolve => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        // Pane names come from the Leaflet _panes registry, not the DOM id —
        // createPane does not set element.id, so read through map.getPane.
        const zOf = id => {
          const pane = window.map.getPane("foliplus-annotation-" + id);
          return pane ? parseInt(pane.style.zIndex) || 0 : null;
        };
        const layerZOf = id => {
          const pane = window.map.getPane(id + "_pane");
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
        // Every owned pane carries the base class through ensurePane; the
        // annotation role marker sits on top of it.
        const paneClassesOf = id => {
          const pane = window.map.getPane("foliplus-annotation-" + id);
          if (!pane) return null;
          return {
            layer: pane.classList.contains("foliplus-layer-pane"),
            annotation: pane.classList.contains("foliplus-annotation-pane"),
          };
        };
        resolve({
          canvas: true,
          // One pane + one canvas per labelled layer, z-ordered with the layer.
          canvasCount: document.querySelectorAll(".foliplus-annotation-canvas").length,
          opaqueA: opaqueOf("__ml_a__"),
          opaqueB: opaqueOf("__ml_b__"),
          annA: zOf("__ml_a__"),
          annB: zOf("__ml_b__"),
          layerA: layerZOf("__ml_a__"),
          layerB: layerZOf("__ml_b__"),
          paneClassesA: paneClassesOf("__ml_a__"),
          paneClassesB: paneClassesOf("__ml_b__"),
        });
      }),
    );
  });
};
