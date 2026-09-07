() => {
  // Compare content-box heights: both controls carry the same 1px border, and
  // getComputedStyle(height) returns the border-box value, so subtract border
  // and padding to get the content height that line-height actually sets.
  const s = document.querySelector(".foliplus-scale-wrap");
  const a = document.querySelector(".leaflet-control-attribution");
  if (!s || !a) return null;
  const contentHeight = el => {
    const cs = getComputedStyle(el);
    return (
      parseFloat(cs.height) -
      parseFloat(cs.paddingTop) -
      parseFloat(cs.paddingBottom) -
      parseFloat(cs.borderTopWidth) -
      parseFloat(cs.borderBottomWidth)
    );
  };
  return {
    scale: contentHeight(s),
    attr: contentHeight(a),
  };
};
