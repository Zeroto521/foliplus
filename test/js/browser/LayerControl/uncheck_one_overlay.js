() => {
  const cbs = document.querySelectorAll(
    '.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item) input[type="checkbox"]',
  );
  if (cbs[1]) cbs[1].click();
};
