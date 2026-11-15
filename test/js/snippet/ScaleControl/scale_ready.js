() => {
  const wrap = document.querySelector(".foliplus-scale-wrap");
  const attr = document.querySelector(".leaflet-control-attribution");
  if (!wrap || !attr) return false;
  const line = getComputedStyle(wrap).lineHeight;
  return line !== "normal" && line === getComputedStyle(attr).lineHeight;
};
