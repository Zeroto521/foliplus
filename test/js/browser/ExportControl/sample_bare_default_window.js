() => {
  // Sample the marker window in the renderer's output canvas and report the
  // blue-dominant ratio among non-transparent pixels.
  //
  // The default Leaflet marker icon main color is (46,133,203) with a white
  // outline and antialiased edges. A pixel is "blue-dominant" when B >= 150,
  // B-R >= 60 and B-G >= 50: this admits the icon body (B~203 >> R~46, G~133)
  // and most of the antialiased blue edge, but rejects the white outline
  // (B=R=G) and the neutral gray background (B=R=G=221). Counting the ratio
  // of blue-dominant pixels among non-transparent pixels makes the assertion
  // robust to the exact icon artwork and to the crop-box window placement: the
  // marker body occupies well over half of the icon bbox (25x41), so a
  // correctly drawn default icon must be blue-dominant in more than half of
  // the window's opaque pixels. A missing / wrong-color / wrong-shape draw
  // (or a blank canvas) cannot reach that ratio.
  const canvases = window._capturedCanvases || [];
  if (canvases.length === 0) return null;
  const c = canvases[canvases.length - 1];
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  // The window comes from the same set_sample_window_params call (the test
  // passes the marker window as _sampleWindows.marker), so this reads it from
  // the same store to avoid a second source of truth.
  const win = (window._sampleWindows && window._sampleWindows.marker) || {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  };
  const { data } = ctx.getImageData(win.x, win.y, win.w, win.h);
  let total = 0;
  let blue = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    total++;
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    if (b >= 150 && b - r >= 60 && b - g >= 50) blue++;
  }
  return { total, blue, ratio: total > 0 ? blue / total : 0 };
};
