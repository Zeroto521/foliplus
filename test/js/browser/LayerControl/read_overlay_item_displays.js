() => {
  const items = document.querySelectorAll(
    '.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)',
  );
  return Array.from(items).map(el => getComputedStyle(el).display);
};
