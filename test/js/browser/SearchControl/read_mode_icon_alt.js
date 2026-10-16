() => {
  // ICON_GLOBE (coordinate mode): the large globe circle sits at cy=12.
  // Address mode uses ICON_LOCATION_PIN with a pin head at cy=9 instead.
  const btn = document.querySelector(".foliplus-search-mode-btn");
  return btn.querySelector('circle[cx="12"][cy="12"][r="10"]') !== null;
};
