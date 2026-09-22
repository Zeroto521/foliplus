() => {
  // Mark tilePane hidden the same way the solid-color basemap does:
  // LayerControl stamps `.foliplus-layer-tile-hidden` rather than unchecking
  // every tile layer, so every `li.visible` stays true. That is the input the
  // export has to cope with — the URL enumeration still enumerates tile
  // URLs, and without a guard they repaint over the colour the user just
  // picked.
  const tilePane = window.map.getPane("tilePane");
  if (!tilePane) return false;
  tilePane.classList.add("foliplus-layer-tile-hidden");
  return getComputedStyle(tilePane).visibility === "hidden";
};
