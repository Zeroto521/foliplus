fixtures => {
  const mm = window.__measureManager;
  if (!mm) return { error: "no mm" };
  mm.layers.mainLayer.addLayer(
    L.polyline(fixtures.line, {
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
