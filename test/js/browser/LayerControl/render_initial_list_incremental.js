() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const panel = document.querySelector(".foliplus-panel-content");
  // Track re-renders by watching innerHTML replacement
  let innerHTMLSets = 0;
  const origDesc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  // Count full-list rebuilds via ui.renderInitialList call
  let renderCalls = 0;
  const ui = api.ui;
  if (ui && ui.renderInitialList) {
    const origRender = ui.renderInitialList;
    ui.renderInitialList = function () {
      renderCalls++;
      return origRender.call(this);
    };
  }
  // Register two layers; each should NOT trigger a full rebuild
  const mg1 = api.createLayers({
    id: "__incr_1__",
    name: "Incr1",
    graphPane: "__incr_g1__",
  });
  mg1.mainLayer.addLayer(
    L.polyline([
      [26.08, 119.3],
      [26.09, 119.31],
    ]),
  );
  const afterFirst = renderCalls;
  const mg2 = api.createLayers({
    id: "__incr_2__",
    name: "Incr2",
    graphPane: "__incr_g2__",
  });
  mg2.mainLayer.addLayer(
    L.polyline([
      [26.08, 119.3],
      [26.09, 119.31],
    ]),
  );
  const afterSecond = renderCalls;
  return { afterFirst, afterSecond };
};
