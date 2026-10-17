() => {
  // ICON_LOCATION_PIN has a small pin-head circle at cy=9 (address mode);
  // ICON_GLOBE instead has a large circle at cy=12 (see read_mode_icon_alt).
  const btn = document.querySelector(".foliplus-search-mode-btn");
  return btn.querySelector('circle[cx="12"][cy="9"]') !== null;
};
