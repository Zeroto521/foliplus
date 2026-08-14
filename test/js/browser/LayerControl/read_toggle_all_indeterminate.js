() => {
  const cb = document.querySelector(
    '.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]',
  );
  return cb.indeterminate;
};
