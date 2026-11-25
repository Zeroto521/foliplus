// Seed the persisted layer-layout block order so the control boots with the
// folder key + both roots LISTED (the stale-order precondition).
() => {
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (!ctrl) throw new Error("control not attached");
  const container = ctrl.closest(".leaflet-container");
  if (!container) throw new Error("map container not found");
  const key = `foliplus_layer_layout_${container.id}`;
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 2,
      data: {
        version: 2,
        folders: [{ key: "a", name: "a" }],
        order: { overlay: ["a", "layer:root1", "layer:root2"] },
        members: {},
      },
    }),
  );
  return { key, stored: localStorage.getItem(key) !== null };
};
