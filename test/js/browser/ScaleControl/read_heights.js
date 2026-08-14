() => {
  // Compare the scale wrap height with the attribution height.
  const s = document.querySelector(".foliplus-scale-wrap");
  const a = document.querySelector(".leaflet-control-attribution");
  if (!s || !a) return null;
  return {
    scale: s.getBoundingClientRect().height,
    attr: a.getBoundingClientRect().height,
  };
};
