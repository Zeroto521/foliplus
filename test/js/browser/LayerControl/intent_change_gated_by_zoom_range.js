() => {
  // Reproduce the user's bug scenario: at map zoom 12 a layer whose stored
  // zoom range is [15, 18] is policy-hidden. A `setVisible(id, true)` call
  // flips the user's stored intent from false to true, but the effective
  // visibility stays false because the policy still gates it — so
  // `LAYER_CHANGE` (which rides the effective flip) never fires.
  //
  // `LAYER_INTENT_CHANGE` is the channel that lets external controls
  // (a cycling slider, an external checkbox mirror) see the user's
  // intent movement even when policy blocks the effective change.
  //
  // The first `setVisible(false)` establishes the false-intent baseline
  // while the range is already in effect; the second `setVisible(true)`
  // is the assertion subject.
  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "no __layerCtrl" };
  const map = ctrl.mgr.map;
  const ui = ctrl.mgr.ui;
  const api = map.foliplus.LayerAPI;
  const events = map.foliplus.events;

  const geo = L.geoJson({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "p1" },
        geometry: { type: "Point", coordinates: [119.3, 26.08] },
      },
    ],
  });
  const id = "__test_intent_gated__";
  api.registerLayer({ id, name: "IntentGated", layer: geo });
  ctrl.mgr.enforceOrder();

  const layerObj = api.findLayer(id);
  if (!layerObj) return { error: "layer not on the map" };

  // Push the range entirely above the current zoom (12): the layer is
  // policy-hidden regardless of the intent, and stays hidden through
  // the whole probe.
  ui.intentStore.set(id, "zoomRange", [15, 18]);
  ui.applyProjectionAll();

  // First setVisible(false): move the user's intent to false while the
  // layer is already policy-hidden. This establishes the false-intent
  // baseline the second call flips from.
  api.setVisible(id, false);
  ui.applyProjectionAll();

  const beforeShow = {
    intentVisible: api.intentVisible(id),
    onMap: map.hasLayer(layerObj),
  };

  const intentSeen = [];
  const changeSeen = [];
  const intentHandler = p => intentSeen.push(p);
  const changeHandler = p => changeSeen.push(p);
  events.on("foliplus:layer:intent-change", intentHandler);
  events.on("foliplus:layer:change", changeHandler);

  // The assertion subject: user checks the box while policy still gates.
  const ok = api.setVisible(id, true);

  const afterShow = {
    intentVisible: api.intentVisible(id),
    onMap: map.hasLayer(layerObj),
  };

  const intentFor = intentSeen.filter(p => p && p.id === id);
  const changeFor = changeSeen.filter(p => p && p.id === id);

  events.off("foliplus:layer:intent-change", intentHandler);
  events.off("foliplus:layer:change", changeHandler);

  return {
    zoom: map.getZoom(),
    range: [15, 18],
    ok,
    beforeShow,
    afterShow,
    intentCount: intentFor.length,
    intentPayloads: intentFor,
    changeCount: changeFor.length,
    changePayloads: changeFor,
  };
};
