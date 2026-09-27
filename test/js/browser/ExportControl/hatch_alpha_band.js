() => {
  // Count pixels in the A' hatch's own alpha band on the export canvas.
  //
  // The hatch is `repeating-conic-gradient(rgba(0,0,0,0.07) 0% 25%,
  // transparent 0% 50%)` on the map container. `resolveExportBackground`
  // only reads `backgroundColor`, so a correctly-behaving export must never
  // see the hatch — but this test needs to gate on the *artifact*, not the
  // implementation. On the export canvas the hatch would leave a signature
  // band of pixels with alpha near 0.07 * 255 ≈ 18: the hatch alternates a
  // translucent 7% black over a fully transparent stripe every 8px.
  //
  // The band is deliberately narrow (10..30). Above that we're past the
  // hatch (real content, or an opaque background); below that the hatch
  // would have been drawn over something already transparent, which is not
  // a state the renderer produces. So a non-zero count is unambiguous
  // evidence the hatch reached the export.
  const canvases = window._capturedCanvases || [];
  if (canvases.length === 0) return null;
  const c = canvases[canvases.length - 1];
  const ctx2d = c.getContext("2d");
  if (!ctx2d) return null;
  const { data } = ctx2d.getImageData(0, 0, c.width, c.height);
  let nonTransparent = 0;
  let band = 0;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a > 0) nonTransparent++;
    if (a >= 10 && a <= 30) band++;
  }
  return {
    nonTransparent,
    band,
    w: c.width,
    h: c.height,
  };
};
