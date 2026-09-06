() => {
  const btn = document.querySelector(
    '.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn',
  );
  // Count svg elements and their shape children rather than asserting the
  // shape tag name: the bare dev build keeps <polyline>, while the minified
  // release build (SVGO) rewrites it to <path>. The contract under test is
  // that the icon is one element, rotated by CSS instead of being swapped.
  return {
    svgCount: btn.querySelectorAll("svg").length,
    shapeCount: btn.querySelectorAll(
      "svg polyline, svg path, svg polygon, svg line",
    ).length,
  };
};
