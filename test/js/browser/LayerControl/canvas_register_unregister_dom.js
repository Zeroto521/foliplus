() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const cvs = api.createCanvas({ id: "__test_canvas_reg__", name: "Canvas Test" });
  cvs.register();
  const item = document.querySelector('[data-layer-id="__test_canvas_reg__"]');
  const hasItem = !!item;
  cvs.unregister();
  const itemAfter = document.querySelector('[data-layer-id="__test_canvas_reg__"]');
  return { hasItem, hasItemAfter: !!itemAfter };
};
