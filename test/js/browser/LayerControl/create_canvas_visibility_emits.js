() => {
  const map = window.map;
  const api = map && map.foliplus && map.foliplus.LayerAPI;
  if (!api) return { error: "LayerAPI not found" };
  if (typeof api.createCanvas !== "function") {
    return { error: "LayerAPI.createCanvas missing" };
  }

  const events = map.foliplus.events;
  const seen = [];
  const handler = payload => {
    seen.push(payload);
  };
  events.on("foliplus:layer:change", handler);

  const cvs = api.createCanvas({ id: "__test_canvas_vis__" });
  cvs.register();
  // Register itself emits one LAYER_CHANGE (the layer entered the map).
  // Baseline the counter past it: subsequent counts are diff from register.
  const baseline = seen.length;
  const our = () => seen.filter(p => p && p.id === "__test_canvas_vis__");

  const out = {
    registerEmits: our().length,
    hiddenBefore: cvs.canvas.classList.contains("hidden"),
  };

  api.setVisible("__test_canvas_vis__", false);
  out.hiddenAfterFalse = cvs.canvas.classList.contains("hidden");
  out.eventsAfterFalse = our().length - baseline;
  out.lastAfterFalse = our()[our().length - 1] || null;

  api.setVisible("__test_canvas_vis__", true);
  out.hiddenAfterTrue = cvs.canvas.classList.contains("hidden");
  out.eventsAfterTrue = our().length - baseline;
  out.lastAfterTrue = our()[our().length - 1] || null;

  api.setVisible("__test_canvas_vis__", false);
  out.eventsAfterSecondFalse = our().length - baseline;

  events.off("foliplus:layer:change", handler);
  return out;
};
