window.turf = {
  distance: (a, b, o) =>
    L.latLng(a.geometry.coordinates[1], a.geometry.coordinates[0]).distanceTo(
      L.latLng(b.geometry.coordinates[1], b.geometry.coordinates[0]),
    ),
  bearing: (a, b) => {
    const dL =
      ((b.geometry.coordinates[0] - a.geometry.coordinates[0]) * Math.PI) / 180;
    const l1 = (a.geometry.coordinates[1] * Math.PI) / 180;
    const l2 = (b.geometry.coordinates[1] * Math.PI) / 180;
    const y = Math.sin(dL) * Math.cos(l2);
    const x = Math.cos(l1) * Math.sin(l2) - Math.sin(l1) * Math.cos(l2) * Math.cos(dL);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  },
  area: p => {
    const R = 6378137;
    const d2r = Math.PI / 180;
    const pts = p.geometry.coordinates[0];
    let a = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i],
        p2 = pts[i + 1];
      a += (p2[0] - p1[0]) * d2r * (2 + Math.sin(p1[1] * d2r) + Math.sin(p2[1] * d2r));
    }
    return Math.abs((a * R * R) / 2);
  },
  point: c => ({ geometry: { coordinates: [c[0], c[1]], type: "Point" } }),
  polygon: c => ({ geometry: { coordinates: c, type: "Polygon" } }),
  midpoint: (a, b) => ({
    geometry: {
      coordinates: [
        (a.geometry.coordinates[0] + b.geometry.coordinates[0]) / 2,
        (a.geometry.coordinates[1] + b.geometry.coordinates[1]) / 2,
      ],
      type: "Point",
    },
  }),
};
