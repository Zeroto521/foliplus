() => {
  const cbs = document.querySelectorAll(
    '.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item) input[type="checkbox"]',
  );
  cbs.forEach(cb => {
    if (cb.checked) cb.click();
  });
};
