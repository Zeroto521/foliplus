() => {
  const items = document.querySelectorAll(
    '.foliplus-layer-item:not([data-layer-type="base"])',
  );
  return Array.from(items).map(el => getComputedStyle(el).display);
};
