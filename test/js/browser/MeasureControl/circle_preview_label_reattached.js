async () => {
  // While the circle preview is live, the radius label chip must be the LAST
  // marker child of the label pane on every frame — it is the newest element
  // in the pane, so it sits above every other label chip that pane holds.
  //
  // Before the fix the label was moved in place with setLatLng, which keeps
  // the sibling position from creation time. If a label entered the pane
  // after the preview started, the preview chip stayed ahead of it and was
  // painted under — the moving preview label vanished below the earlier
  // chip.
  //
  // A real "finalised label then second preview" probe is not reproducible
  // here: after `finishCircle` commits, `bindLayerRemoved` reacts to the
  // measure layer's `LAYER_REMOVED` (from `clearActiveMode()`'s
  // `this.layers.unregister()`) and silently clears the mode, so the second
  // `setMode("circle")` refuses to arm. We simulate the same pane state by
  // planting an equivalent label chip through the manager's own `layers`
  // factory (the same path `finishCircle` uses) and starting a fresh
  // preview — the pane then holds an older chip plus the moving preview,
  // and we assert the preview re-sorts to the tail on every frame.
  const mm = window.__measureManager;
  const map = window.__map;
  const LL = L.latLng;

  const labelPane = () =>
    document
      .querySelector(".foliplus-measure-label-radius")
      ?.closest(".leaflet-pane") ?? null;

  // Radius-label chips in the pane, in DOM order.
  const chips = () =>
    Array.from(labelPane()?.children ?? [])
      .filter(el => el.classList.contains("leaflet-marker-icon"))
      .map(el => ({
        text: el.querySelector(".foliplus-measure-label-radius")?.textContent ?? "",
      }));

  // Plant one older finalised-style label chip in the measure label pane,
  // via the same factory `finishCircle` uses.
  mm.layers.addLayer(
    L.marker([26.0805, 119.3005], {
      icon: L.divIcon({
        className: "",
        html: '<div class="foliplus-measure-label foliplus-measure-label-radius" data-foliplus-export="label">1 m</div>',
        iconSize: [60, 20],
        iconAnchor: [30, 10],
      }),
      interactive: false,
    }),
    "measure_label",
  );

  const plantedCount = chips().length;
  if (plantedCount !== 1) throw new Error(`planted chip not present: ${plantedCount}`);

  // Now start a preview. The preview chip must re-sort itself to the tail
  // of the label pane on every mousemove frame.
  mm.setMode("circle");
  map.invalidateSize();
  map.fire("preclick", { latlng: LL(26.08, 119.3) });
  map.fire("click", { latlng: LL(26.08, 119.3) });

  const moves = [
    [26.0801, 119.3001],
    [26.0805, 119.3005],
    [26.081, 119.301],
    [26.085, 119.305],
  ];
  const frames = [];
  for (const [la, ln] of moves) {
    map.fire("mousemove", { latlng: LL(la, ln) });
    const all = chips();
    frames.push({
      total: all.length,
      // The preview chip is the newest one in the pane; it must be at the
      // tail (last index) on every frame.
      lastIdx: all.length - 1,
      lastText: all[all.length - 1]?.text ?? "",
    });
  }

  return {
    frames,
    // The preview chip (the newest one) must be the last child of the pane
    // on every frame, with a non-empty distance label that differs from the
    // planted chip's text.
    alwaysLast: frames.every(
      f =>
        f.total === plantedCount + 1 &&
        f.lastIdx === f.total - 1 &&
        f.lastText &&
        f.lastText !== "1 m",
    ),
  };
};
