() => {
  const firstOverlay = document.querySelector('.foliplus-layer-item:not(.foliplus-color-layer-item)');
  if (!firstOverlay) return null;
  const cb = firstOverlay.querySelector('input[type="checkbox"]');
  if (!cb) return null;
  cb.click();
  return { clicked: true };
};
