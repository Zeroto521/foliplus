() => {
  const cbs = document.querySelectorAll(
    '.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item) input[type="checkbox"]',
  );
  return Array.from(cbs).map(cb => cb.checked);
};
