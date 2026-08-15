() => {
  const colorItem = document.querySelector('.foliplus-color-layer-item');
  if (!colorItem) return null;
  const cb = colorItem.querySelector('input[type="checkbox"]');
  if (!cb) return null;
  const before = document.querySelector('.leaflet-tile-pane')?.classList.contains('foliplus-layer-tile-hidden');
  cb.click();
  const after = document.querySelector('.leaflet-tile-pane')?.classList.contains('foliplus-layer-tile-hidden');
  return { tileHiddenBefore: !!before, tileHiddenAfter: !!after };
};
