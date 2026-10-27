() => {
  const cb = document.querySelector(
    '.foliplus-layer-toggle-all[data-role="overlay"] [data-role="toggle-all"]',
  );
  return cb ? cb.title : null;
};
