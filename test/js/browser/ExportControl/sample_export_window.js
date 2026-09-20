() => {
  // Sample a specific rectangular window in the renderer's output canvas.
  // Takes window coords from window._sampleWindows (set by the test), and
  // returns {hit, total} for each window. The caller picks the target colour
  // via window._sampleColor.
  //
  // Windows are specified as {x, y, w, h} in export-canvas pixel coords.
  const canvases = window._capturedCanvases || [];
  if (canvases.length === 0) return null;
  const c = canvases[canvases.length - 1];
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  const windows = window._sampleWindows || {};
  const [r, g, b] = window._sampleColor || [230, 30, 30];
  const tol = window._sampleTol || 30;
  const alphaMin = window._sampleAlphaMin || 200;

  const result = {};
  for (const [name, win] of Object.entries(windows)) {
    const { data } = ctx.getImageData(win.x, win.y, win.w, win.h);
    let hit = 0;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) total++;
      const near =
        Math.abs(data[i] - r) <= tol &&
        Math.abs(data[i + 1] - g) <= tol &&
        Math.abs(data[i + 2] - b) <= tol &&
        data[i + 3] > alphaMin;
      if (near) hit++;
    }
    result[name] = { hit, total };
  }
  return result;
};
