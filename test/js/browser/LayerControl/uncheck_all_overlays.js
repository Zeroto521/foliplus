() => {
  const cbs = document.querySelectorAll(
    '.foliplus-layer-item:not([data-layer-type="base"]) input[type="checkbox"]',
  );
  cbs.forEach(cb => {
    if (cb.checked) cb.click();
  });
};
