// Creation-time z acceptance gate: a freshly created pane must carry the
// layer's exact slot z (or the base of its tier when not yet registered),
// never Leaflet's CSS default of 400. `enforceOrder` rewrites the z on
// registry changes, but the creation-time value is already correct.
//
// Driver: window.__probe = { action: "read" | "enforce" | "create-canvas" }
//   read          — return current z-indexes of every foliplus-layer pane
//   enforce       — call enforceOrder, then read
//   create-canvas — call LayerAPI.createCanvas, read the new pane's z
() => {
  const spec = window.__probe || { action: "read" };
  delete window.__probe;
  const ctrl = window.__layerCtrl;
  const map = window.map;
  if (!ctrl || !map) return { error: "ctrl or map missing" };
  const m = ctrl.m;

  const readPanes = () =>
    Array.from(document.querySelectorAll(".leaflet-pane"))
      .filter(p => p.className.includes("foliplus-layer-pane"))
      .map(p => ({
        name: p.id,
        z: parseInt(getComputedStyle(p).zIndex, 10) || null,
      }));

  if (spec.action === "enforce") {
    m.enforceOrder();
    return { ok: true, action: "enforce", panes: readPanes() };
  }

  if (spec.action === "create-canvas") {
    const api = map.foliplus.LayerAPI;
    const id = `probe_canvas_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const handle = api.createCanvas({ id, name: "Probe Canvas" });
    const panes = readPanes();
    const newPane = panes.find(p => p.name.includes(id));
    // Destroy inside the probe — a returned handle cannot survive page.evaluate
    // serialization, so leave the registry clean for the next action.
    handle.destroy();
    return {
      ok: true,
      action: "create-canvas",
      panes,
      newPane,
      // The new pane must not be at 400 (Leaflet's CSS default). When the
      // layer is not yet registered (index = count), it prices at the base
      // of the overlay tier (BASE = 600), not the top.
      notAt400: newPane ? newPane.z !== 400 : null,
    };
  }

  return { ok: true, action: "read", panes: readPanes() };
};
