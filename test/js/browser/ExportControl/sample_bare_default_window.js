() => {
  // Classify the renderer's output canvas pixels into opaque / colored /
  // blue and report the blue-dominant share of the colored content.
  //
  // The export canvas is fully OPAQUE: the renderer fills it with the map
  // container's computed background (Leaflet's default #ddd) before any
  // pass draws (renderer/index.ts render(), util.ts resolveExportBackground).
  // So an alpha>0 denominator is the whole canvas and cannot isolate the
  // icon — the #813 window-based red test never hit this because a solid
  // data-URI tile covered the whole crop, but a bare marker sits on the
  // neutral background. The colored denominator (chroma = max-min > 40)
  // isolates the icon instead: the blue marker body (46,133,203) and its
  // antialiased blue edge are colored, while the neutral gray background
  // (R=G=B) and the neutral gray marker-shadow.png (chroma ~0) are NOT.
  //
  // The tiles are hidden in setup_bare_default_marker, so the ONLY colored
  // content on the canvas is the default blue marker icon. blue/colored is
  // therefore "how much of the drawn icon body is the default blue",
  // independent of the crop geometry, the 2x scale, and the opaque
  // background. A missing icon (no colored content), a wrong-color draw
  // (low blue), or a blank export all fail cleanly.
  const canvases = window._capturedCanvases || [];
  if (canvases.length === 0) return null;
  // Pick the largest captured canvas (the renderer's output), never a label
  // or heatmap canvas the hook also intercepts.
  const c = canvases.reduce(
    (best, cv) => (cv.width * cv.height > best.width * best.height ? cv : best),
    canvases[0],
  );
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let total = 0;
  let opaque = 0;
  let colored = 0;
  let blue = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2],
      a = data[i + 3];
    total++;
    if (a === 0) continue;
    opaque++;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (chroma > 40) colored++;
    // Default marker-icon.png main color (46,133,203): blue-dominant, R well
    // below B. Antialiased edges blend toward the neutral background but keep
    // the B >= 150 && B-R >= 60 && B-G >= 50 signature in the icon body.
    if (b >= 150 && b - r >= 60 && b - g >= 50) blue++;
  }
  return {
    total,
    opaque,
    colored,
    blue,
    ratio: colored > 0 ? blue / colored : 0,
  };
};
