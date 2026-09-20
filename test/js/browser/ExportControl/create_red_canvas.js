() => {
  // Register a canvas layer that paints one red rectangle, then draw the
  // rectangle. The rectangle occupies the central 20% of the viewport along
  // each axis, so it falls inside the default crop box (25% padding from
  // each edge) and its red pixels are a stable discriminator in the export:
  // a canvas layer that is excluded from the export (a regression on the
  // `.foliplus-canvas-layer` "content, not decoration" contract) produces
  // zero red pixels, and the red is unambiguous against the OSM grey
  // palette.
  //
  // Draw AFTER register: createCanvas calls resize() which sets the backing
  // store to viewport * dpr; drawing before register would put pixels into a
  // canvas that resize() subsequently clears.
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return false;
  const cvs = api.createCanvas({
    id: "__export_pixel_canvas__",
    name: "Pixel Canvas",
  });
  cvs.register();
  const ctx = cvs.ctx;
  ctx.fillStyle = "rgb(230, 30, 30)";
  ctx.fillRect(
    0.4 * cvs.canvas.width,
    0.4 * cvs.canvas.height,
    0.2 * cvs.canvas.width,
    0.2 * cvs.canvas.height,
  );
  return true;
}
