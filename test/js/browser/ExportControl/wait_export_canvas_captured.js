// wait_for_function predicate: the export renderer captured a canvas.
//
// The renderer's output canvas is created via document.createElement (never
// attached to the DOM); _install_canvas_hook pushes every created canvas onto
// window._capturedCanvases. The collapsed-control wait only proves the export
// flow finished -- the canvas may still be empty or not yet painted. This
// predicate waits until at least one captured canvas is non-empty and has
// non-transparent pixels, so a pixel assertion reads a painted image rather
// than a blank canvas on raster/network timing.
() => {
  const canvases = window._capturedCanvases || [];
  if (canvases.length === 0) return false;
  return canvases.some(cv => {
    if (!cv || cv.width === 0 || cv.height === 0) return false;
    try {
      const ctx = cv.getContext("2d");
      if (!ctx) return false;
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  });
};
