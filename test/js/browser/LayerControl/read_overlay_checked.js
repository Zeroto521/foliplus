() => {
  const cbs = document.querySelectorAll(
    '.foliplus-layer-item:not([data-layer-type="base"]) input[type="checkbox"]',
  );
  return Array.from(cbs).map(cb => cb.checked);
};
