() => {
  const canvases = window._capturedCanvases || [];
  if (canvases.length === 0) return { found: false };
  const c = canvases.reduce(
    (best, cv) => (cv.width * cv.height > best.width * best.height ? cv : best),
    canvases[0],
  );
  const ctx = c.getContext("2d");
  if (!ctx) return { found: false };
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  // The marker icon is a solid red (230,30,30) PNG at pane opacity 0.4. Over
  // an opaque gray(221) background it composites to about (225,145,145); over
  // a transparent background it stays opaque red (230,30,30). Either way the
  // pixel is red-dominant: R high, G and B well below R. Counting red-dominant
  // pixels (rather than merely "not gray") proves the red icon specifically
  // was drawn, and cannot match the neutral gray background itself.
  let nonBg = 0;
  let markerPixels = 0;
  let sample = null;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const isBg =
      Math.abs(r - 221) <= 30 && Math.abs(g - 221) <= 30 && Math.abs(b - 221) <= 30;
    if (!isBg) nonBg++;
    // Red-dominant marker signature: strong red, G/B clearly below R.
    const isMarker = r >= 180 && r - g >= 40 && r - b >= 40;
    if (isMarker) {
      markerPixels++;
      if (!sample) sample = [r, g, b];
    }
  }
  return { found: true, nonBg, markerPixels, sample };
};
