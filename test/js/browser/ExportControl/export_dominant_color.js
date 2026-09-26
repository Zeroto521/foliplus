() => {
  // Report the most frequent non-transparent RGB on the renderer's output
  // canvas. Used alongside a specific-colour sampler so a test failure can
  // distinguish "the target colour is missing because nothing was drawn"
  // from "the target colour is missing because a different layer drew
  // instead". Bins by exact RGB rather than quantising, since our test
  // colours are all solid and any deviation means something regressed.
  const canvases = window._capturedCanvases || [];
  if (canvases.length === 0) return null;
  const c = canvases[canvases.length - 1];
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const counts = new Map();
  let nonTransparent = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    nonTransparent++;
    const key = data[i] * 65536 + data[i + 1] * 256 + data[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let topKey = 0;
  let topCount = 0;
  for (const [k, n] of counts) {
    if (n > topCount) {
      topCount = n;
      topKey = k;
    }
  }
  const r = Math.floor(topKey / 65536);
  const g = Math.floor((topKey % 65536) / 256);
  const b = topKey % 256;
  return {
    dominant: [r, g, b],
    dominantCount: topCount,
    nonTransparent,
    distinct: counts.size,
    w: c.width,
    h: c.height,
  };
};
