() => {
  // T253 pixel + DOM gate for component self-declared export opt-out.
  //
  // Positive control: create_red_canvas paints via the li.canvas special path
  // (must still appear — rendering semantics unchanged).
  // Negative control: a purple marker self-marked
  // data-foliplus-export="exclude" in a foliplus pane must not leak into the
  // export canvas (whole-canvas probe).
  //
  // Hide tiles first so opaque basemap pixels cannot mask the positive control
  // (same approach as export_opacity_blend.js).
  const map = window.map;
  const api = map.foliplus && map.foliplus.LayerAPI;
  if (!api) return { error: "no LayerAPI" };

  for (const li of [...api.layers]) {
    if (li.layer instanceof L.TileLayer) api.setVisible(li.id, false);
  }

  // Positive control — registered canvas layer, special path.
  const cvs = api.createCanvas({
    id: "__export_exclude_pos__",
    name: "Exclude Pos",
  });
  cvs.register();
  const ctx = cvs.ctx;
  ctx.fillStyle = "rgb(230,30,30)";
  ctx.fillRect(
    0.4 * cvs.canvas.width,
    0.4 * cvs.canvas.height,
    0.2 * cvs.canvas.width,
    0.2 * cvs.canvas.height,
  );

  // Negative control — marked purple marker in a foliplus pane.
  const group = api.createLayers({
    id: "__export_exclude_markers__",
    name: "Exclude Markers",
    panes: [{ name: "exclude-markers-pane" }],
  });
  const purple = L.marker([26.08, 119.22], {
    icon: L.divIcon({
      className: "",
      html: "",
      iconSize: [24, 24],
    }),
  });
  purple.on("add", () => {
    const el = purple.getElement();
    if (el) {
      el.setAttribute("data-foliplus-export", "exclude");
      el.style.background = "rgb(128,0,128)";
      el.style.width = "24px";
      el.style.height = "24px";
    }
  });
  group.mainLayer.addLayer(purple);
  group.register();

  return {
    posCanvasId: "__export_exclude_pos__",
    wholeCanvasPurple: { name: "marked_purple_all", color: [128, 0, 128] },
    wholeCanvasRed: { name: "pos_canvas_red", color: [230, 30, 30] },
  };
};
