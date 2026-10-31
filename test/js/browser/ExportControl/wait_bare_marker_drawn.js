// wait_for_function predicate: the export canvas holds blue-dominant marker
// pixels (the true default Leaflet marker-icon.png drawn by renderRemaining's
// <img> branch).
//
// The export background fill is drawn synchronously, but the marker's icon
// image loads asynchronously (renderRemaining awaits loadImage before
// drawImage). _wait_export_canvas_ready only proves the canvas is non-empty
// and opaque -- which the background fill satisfies immediately -- so sampling
// right after it can read a canvas where the marker has not been drawn yet.
// This predicate waits specifically for the blue-dominant signature, the
// observable end state this test asserts on.
() => {
  const canvases = window._capturedCanvases || [];
  if (canvases.length === 0) return false;
  const c = canvases.reduce(
    (best, cv) => (cv.width * cv.height > best.width * best.height ? cv : best),
    canvases[0],
  );
  const ctx = c.getContext("2d");
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    // Default marker icon main color (46,133,203): blue-dominant, R well
    // below B. Antialiased edges blend toward the background but keep the
    // B >= 150 && B-R >= 60 && B-G >= 50 signature in the icon body.
    if (b >= 150 && b - r >= 60 && b - g >= 50) return true;
  }
  return false;
};
