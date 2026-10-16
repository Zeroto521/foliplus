() => {
  const mm = window.__measureManager;
  if (!mm) return { error: "no mm" };
  mm.layers.mainLayer.addLayer(
    L.polyline([[26.078, 119.298], [26.076, 119.302]], {
      color: "red",
      weight: 4,
    }),
  );
  return {
    finalized: true,
    preview: false,
    windows: {
      left: { x: 620, y: 360, w: 40, h: 40 },
    },
  };
};
