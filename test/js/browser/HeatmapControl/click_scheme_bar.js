() => {
  // Opens (or closes) the heatmap panel's scheme list.
  const bar = document.querySelector(".foliplus-heatmap-scheme-bar");
  if (!bar) return false;
  bar.click();
  return true;
};
