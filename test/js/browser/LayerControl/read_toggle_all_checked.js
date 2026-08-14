() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  const cb = document.querySelector(
    '.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]',
  );
  return cb ? cb.checked : "no-cb";
};
