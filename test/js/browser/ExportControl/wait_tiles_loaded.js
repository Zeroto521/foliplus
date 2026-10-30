// wait_for_function predicate: every visible tile image is loaded.
//
// The two-basemap composite asserts a blended pixel dominates the export. If
// the sample runs before the data-URI tiles rasterize into their panes, the
// export canvas holds a partial blend and the >80% dominance check trips on
// timing. This waits until every <img class="tile"> that is actually attached
// to a visible pane reports complete && naturalWidth > 0, so the sample reads
// a fully-painted canvas.
() => {
  const imgs = Array.from(document.querySelectorAll("img.tile"));
  if (imgs.length === 0) return false;
  return imgs.every(img => img.complete && img.naturalWidth > 0);
};
