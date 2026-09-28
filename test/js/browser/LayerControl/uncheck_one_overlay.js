() => {
  const cbs = document.querySelectorAll(
    '.foliplus-layer-item:not([data-layer-type="base"]) input[type="checkbox"]',
  );
  if (cbs[1]) cbs[1].click();
};
