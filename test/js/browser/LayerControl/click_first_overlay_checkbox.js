() => {
  const cb = document.querySelector(
    '.foliplus-layer-item:not([data-layer-type="base"]) input[type="checkbox"]',
  );
  if (cb) cb.click();
};
