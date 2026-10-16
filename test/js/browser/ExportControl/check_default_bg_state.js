() => {
  const c = document.querySelector(".leaflet-container");
  return {
    bg: getComputedStyle(c).backgroundColor,
    hasActive: c.classList.contains("foliplus-active"),
  };
};
