() => {
  // Compare content-box heights.  Attribution carries a 1px border the scale
  // control deliberately doesn't; getComputedStyle(height) returns the
  // border-box value, so subtract the border for both.
  const s = document.querySelector(".foliplus-scale-wrap");
  const a = document.querySelector(".leaflet-control-attribution");
  if (!s || !a) return null;
  const contentHeight = (el) => {
    const cs = getComputedStyle(el);
    return parseFloat(cs.height)
      - parseFloat(cs.paddingTop)
      - parseFloat(cs.paddingBottom)
      - parseFloat(cs.borderTopWidth)
      - parseFloat(cs.borderBottomWidth);
  };
  return {
    scale: contentHeight(s),
    attr: contentHeight(a),
  };
};
