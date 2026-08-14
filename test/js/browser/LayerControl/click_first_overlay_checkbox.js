() => {
  const cb = document.querySelector(
    '.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item) input[type="checkbox"]',
  );
  if (cb) cb.click();
};
