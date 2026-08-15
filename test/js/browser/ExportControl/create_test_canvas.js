() => {
  // Create and register a test canvas layer via the LayerControl API.
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return;
  const cvs = api.createCanvas({
    id: "__test_export_canvas__",
    name: "Test Canvas",
  });
  const ctx = cvs.ctx;
  ctx.fillStyle = "red";
  ctx.fillRect(10, 10, 100, 100);
  cvs.register();
};
