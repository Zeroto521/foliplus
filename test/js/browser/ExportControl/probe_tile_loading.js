() => {
  // Diagnostic for the two-basemap composite test. Reports each LayerControl
  // entry's paneName / URL / opacity so a failure tells you which basemap
  // was missing from the export.
  const api = window.map && window.map.foliplus && window.map.foliplus.LayerAPI;
  const layers = (api && api.layers ? api.layers : []).map(li => ({
    id: li.id,
    name: li.name,
    isBase: li.isBase,
    visible: li.visible,
    paneName: li.paneName,
    layerType: li.layer ? li.layer.constructor.name : null,
    url: li.layer && li.layer._url ? li.layer._url.slice(0, 50) : null,
    opacity: li.layer && li.layer.options ? li.layer.options.opacity : null,
  }));
  const tileImgs = document.querySelectorAll("img.tile");
  const panes = Array.from(
    document.querySelectorAll(
      '[id^="foliplus-pane-"], [id^="foliplus-canvas-"], [id^="foliplus-color-"]',
    ),
  ).map(p => p.id);
  return {
    ok: true,
    layers,
    panes,
    tileImgCount: tileImgs.length,
    firstTileSrc: tileImgs[0] ? tileImgs[0].src.slice(0, 60) : null,
  };
};
