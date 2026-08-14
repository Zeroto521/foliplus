() => {
  // Compare scale line / zoom label font with the attribution font.
  const sl = document.querySelector(".leaflet-control-scale-line");
  const zl = document.querySelector(".foliplus-scale-zoom-label");
  const a = document.querySelector(".leaflet-control-attribution");
  if (!sl || !a) return null;
  const acs = getComputedStyle(a);
  const slcs = getComputedStyle(sl);
  const zlcs = zl ? getComputedStyle(zl) : null;
  return {
    attr: {
      family: acs.fontFamily.split(",")[0].trim(),
      size: acs.fontSize,
      weight: acs.fontWeight,
    },
    scaleLine: {
      family: slcs.fontFamily.split(",")[0].trim(),
      size: slcs.fontSize,
      weight: slcs.fontWeight,
    },
    zoomLabel: zlcs
      ? {
          family: zlcs.fontFamily.split(",")[0].trim(),
          size: zlcs.fontSize,
          weight: zlcs.fontWeight,
        }
      : null,
  };
};
