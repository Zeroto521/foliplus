() => {
  // Risk-2 gate. The focus overlay renderer is a Leaflet L.SVG — every call
  // to `L.svg({ pane })` creates a new renderer that mounts its own <svg>
  // inside the pane. The pane lives for the whole map's life, so a leaked
  // renderer accumulates <svg> siblings. `dismissFocus` uses the public
  // Leaflet teardown path (map.removeLayer on the renderer), so after every
  // cancel the pane should hold exactly one SVG (the live one), never a
  // growing stack. We also verify the control-teardown path via the standard
  // removeControl + addControl re-entry (the pattern already documented in
  // CLAUDE.md).
  const ctrl = window.__layerCtrl;
  if (!ctrl) return { ctrl: false };

  const focusRow = el => el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  const getRow = id => document.querySelector(`.foliplus-layer-item[data-layer-id="${id}"]`);
  const getPane = () => window.map.getPane("foliplus-focus-overlay");
  const countSvgs = () => getPane()?.querySelectorAll("svg").length ?? 0;

  // Three layer rows so the probe can focus more than once.
  const api = window.map.foliplus.LayerAPI;
  const layerIds = [];
  for (let i = 0; i < 3; i++) {
    const id = `__fcyc_${i}`;
    const g = api.createLayers({ id, name: `Cycle${i}` });
    g.mainLayer.addLayer(L.rectangle([
      [26.05 + i * 0.02, 119.25 + i * 0.02],
      [26.08 + i * 0.02, 119.28 + i * 0.02],
    ]));
    // No declared panes → mainLayer.addLayer does not auto-register; call
    // register() explicitly so the row lands in the panel.
    g.register();
    layerIds.push(id);
  }

  // Wait for the panel to refresh so rows render.
  return new Promise(resolve => {
    setTimeout(() => {
      const ui = ctrl.m.ui;
      const before = countSvgs();

      const cycles = [];
      for (let i = 0; i < 3; i++) {
        const row = getRow(layerIds[i]);
        if (!row) {
          cycles.push({ id: layerIds[i], row: false });
          continue;
        }
        focusRow(row);
        const during = {
          svg: countSvgs(),
          rendererLive: ui.focusRenderer !== null,
        };
        ui.cancelFocus();
        cycles.push({
          id: layerIds[i],
          row: true,
          ...during,
          after: {
            svg: countSvgs(),
            rendererNull: ui.focusRenderer === null,
          },
        });
      }

      // Control-teardown path: an in-flight focus must not survive a
      // removeControl + addControl cycle.
      const row0 = getRow(layerIds[0]);
      if (row0) focusRow(row0);
      const svgAtRemove = countSvgs();
      window.map.removeControl(ctrl);
      const svgAfterRemove = countSvgs();
      window.map.addControl(ctrl);
      const svgAfterAdd = countSvgs();

      resolve({
        ctrl: true,
        before,
        cycles,
        teardown: { svgAtRemove, svgAfterRemove, svgAfterAdd },
      });
    }, 400);
  });
};
