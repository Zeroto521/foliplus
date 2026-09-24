() => {
  // Probe the map container's own background state. The A' no-basemap hatch
  // is a `background-image` on `.leaflet-container.no-base-map`; the export
  // renderer reads only `backgroundColor` (see resolveExportBackground), so
  // the gate needs the computed values to prove the empty state is real
  // before it asserts on the export output.
  //
  // `natural` is read first — untouched — and `manual` is a same-evaluate
  // add/remove pair that proves the class itself produces the hatch CSS, so a
  // failure cannot be blamed on the class never having been applied.
  const c = document.querySelector(".leaflet-container");
  if (!c) return { ok: false, reason: "no .leaflet-container" };
  const read = () => {
    const cs = getComputedStyle(c);
    return {
      noBaseMap: c.classList.contains("no-base-map"),
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage,
    };
  };
  const natural = read();
  c.classList.add("no-base-map");
  const manual = read();
  c.classList.remove("no-base-map");
  const api = window.map && window.map.foliplus && window.map.foliplus.LayerAPI;
  const panel = document.querySelector(".foliplus-panel-content");
  return {
    ok: true,
    ...natural,
    manual,
    layers: api && api.layers ? api.layers.map(li => ({ id: li.id, isBase: li.isBase, visible: li.visible })) : null,
    layerItems: document.querySelectorAll(".foliplus-layer-item").length,
    layerCtrlReady: panel ? panel.hasAttribute("data-ready") : false,
  };
};
