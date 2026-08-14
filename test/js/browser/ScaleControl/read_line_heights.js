() => {
  // Compare the scale wrap / zoom label line-height with the attribution.
  const s = document.querySelector(".foliplus-scale-wrap");
  const zl = document.querySelector(".foliplus-scale-zoom-label");
  const a = document.querySelector(".leaflet-control-attribution");
  if (!s || !a) return null;
  return {
    wrap: getComputedStyle(s).lineHeight,
    attr: getComputedStyle(a).lineHeight,
    zoomLabel: zl ? getComputedStyle(zl).lineHeight : null,
  };
};
