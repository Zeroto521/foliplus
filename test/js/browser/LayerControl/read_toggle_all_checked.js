() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const cb = document.querySelector(
    '.foliplus-layer-toggle-all[data-role="overlay"] [data-role="toggle-all"]',
  );
  return cb ? cb.checked : "no-cb";
};
