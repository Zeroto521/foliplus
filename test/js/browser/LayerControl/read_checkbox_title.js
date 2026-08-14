() => {
  const cb = document.querySelector(
    '.foliplus-layer-item:not(.foliplus-color-layer-item) input[type="checkbox"]',
  );
  return cb ? cb.title : null;
};
