() => {
  return (function () {
    const mm = window.__measureManager;
    const map = window.__map;
    if (!mm || !map) return { error: "no mm or map" };
    // Finalized line near center (inside crop box).
    mm.layers.mainLayer.addLayer(
      L.polyline([[26.078, 119.298], [26.076, 119.302]], {
        color: "red",
        weight: 4,
      }),
    );
    // Preview: enter distance mode, click once (right area).
    mm.setMode("distance");
    map.fire("click", { latlng: L.latLng(26.078, 119.303) });
    map.fire("mousemove", { latlng: L.latLng(26.076, 119.304) });
    return {
      finalized: true,
      preview: true,
      windows: {
        left: { x: 620, y: 360, w: 40, h: 40 },
        right: { x: 200, y: 360, w: 40, h: 40 },
      },
    };
  })();
};
