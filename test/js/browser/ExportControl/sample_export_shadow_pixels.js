() => {
  // Count the marker-shadow pixels in the renderer's output canvas.
  //
  // Tile layers are hidden, so the only content is the marker pin and its
  // shadow. The export background is Leaflet's neutral #ddd (221,221,221);
  // a marker shadow sprite is neutral grey, darker than that background.
  // Cadetblue pin pixels and the white glyph are not neutral-and-darker
  // (the pin is saturated, the glyph is brighter), so counting
  // "neutral, clearly darker than the background" isolates the shadow.
  const canvases = window._capturedCanvases || [];
  if (canvases.length === 0) return null;
  const c = canvases[canvases.length - 1];
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let shadow = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const neutral = Math.max(r, g, b) - Math.min(r, g, b) <= 10;
    if (neutral && r < 210) shadow++;
  }
  return { shadow, w: c.width, h: c.height };
};
