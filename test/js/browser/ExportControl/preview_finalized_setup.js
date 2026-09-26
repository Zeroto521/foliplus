() => {
  // Set up the (a) gate: finalized vs preview dual-window test.
  //
  // Creates a finalized polyline (red) in the LEFT area of the viewport,
  // then optionally starts a distance measurement (preview) in the RIGHT area.
  //
  // Two non-overlapping windows:
  //   left  — finalized line only
  //   right — preview line only (when in drawing state)
  //
  // In drawing state: left > 0, right == 0 (preview excluded by SKIP_EXPORT).
  // Not in drawing state: left > 0 (finalized still rendered, reverse gate).
  //
  // The finalized polyline spans from [26.08, 119.22] to [26.08, 119.28]
  // (left area). The preview click is at [26.08, 119.36] (right area).
  //
  // Returns { finalized: bool, preview: bool, windows: {left, right} }.

  const mm = window.__measureManager;
  const map = window.__map;
  if (!mm || !map) return { error: "no measureManager or map" };

  // --- Finalized line: red polyline in the left area ---
  const finalized = L.polyline(
    [
      [26.085, 119.215],
      [26.075, 119.225],
    ],
    { color: "red", weight: 4 },
  );
  mm.layers.mainLayer.addLayer(finalized);

  let preview = false;
  if (arguments.length > 0 && arguments[0] === true) {
    // --- Preview line: start distance mode, click once (creates preview) ---
    mm.setMode("distance");
    map.fire("click", { latlng: L.latLng(26.08, 119.36) });
    map.fire("mousemove", { latlng: L.latLng(26.085, 119.37) });
    preview = true;
  }

  // --- Compute window rectangles in export-canvas pixel coords ---
  // Export canvas: 1280x720. Crop box: CSS (320,240) to (960,600).
  // CSS y=420 (center) → canvas y = 2*(420-240) = 360.
  // CSS x = 320 + f*640 → canvas x = 2*f*640 = 1280*f.
  //
  // Left window (finalized): f=0.30 → canvas x=384, y=360
  // Right window (preview):  f=0.70 → canvas x=896, y=360
  // Window size: 80x80 canvas px.

  return {
    finalized: true,
    preview,
    windows: {
      left: { x: 344, y: 320, w: 80, h: 80 },
      right: { x: 856, y: 320, w: 80, h: 80 },
    },
  };
};
