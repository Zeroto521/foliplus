() => {
  // Compare the scale wrap's line-height with the attribution's. The wrap is
  // display:flex and centers its children with align-items: center, so this
  // value does not drive the rendered box height — the box heights are
  // compared separately in read_heights.js.
  const w = document.querySelector(".foliplus-scale-wrap");
  const zl = document.querySelector(".foliplus-scale-zoom-label");
  const a = document.querySelector(".leaflet-control-attribution");
  if (!w || !a) return null;
  return {
    wrap: getComputedStyle(w).lineHeight,
    attr: getComputedStyle(a).lineHeight,
    zoomLabel: zl ? getComputedStyle(zl).lineHeight : null,
  };
};
