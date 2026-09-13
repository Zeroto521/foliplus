// Regression guard for the removed CORS pre-setup: ExportControl must not
// rewrite live tile layers (options.crossOrigin) nor register a permanent
// `layeradd` listener on the map — the old behaviour blanked non-CORS base
// maps, flashed the viewport on init, and leaked the listener.
() => {
  const crossOrigins = () => {
    const out = [];
    window.__map.eachLayer(layer => {
      if (layer instanceof L.GridLayer) out.push(layer.options.crossOrigin ?? null);
    });
    return out;
  };
  const layeraddHandlers = () => {
    const ev = (window.__map._events || {}).layeradd;
    return Array.isArray(ev) ? ev.map(h => String(h.fn)) : [];
  };
  const before = { crossOrigins: crossOrigins(), layeraddHandlers: layeraddHandlers() };
  window.__map.removeControl(window.__exportCtrl);
  window.__map.addControl(window.__exportCtrl);
  const after = { crossOrigins: crossOrigins(), layeraddHandlers: layeraddHandlers() };
  return { before, after };
};
