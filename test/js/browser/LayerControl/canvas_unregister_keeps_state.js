async () => {
  // A user-added layer keeps the user's stored opacity across unregister and
  // loses it only on an explicit delete.
  //
  // unregisterLayer is a generic teardown, and HeatmapControl reaches it
  // whenever its data goes empty: clearHeatmapCanvas() calls
  // overlay.unregister(). Nothing about an empty frame says the user's
  // opacity should revert to the author default, so the only call that may
  // erase a value is an explicit delete.
  //
  // The layer is registered WITHOUT styleSetters so it is user-owned:
  // deleteLayer dispatches by ownership (#499) — a component-owned layer
  // (styleSetters present) only gets a LAYER_DELETED event and keeps its
  // stored state, while a user layer is retired and its record is pruned.
  const api = window.map?.foliplus?.LayerAPI;
  if (!api) return { error: "no LayerAPI" };
  // Writes are debounced (SAVE_DEBOUNCE_MS), so every read waits past the flush.
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const id = "__del_probe__";
  // The record is created by the first write, so the key is looked up on
  // every read rather than before any of this has happened.
  const stored = () => {
    const key = Object.keys(localStorage).find(k =>
      k.startsWith("foliplus_layer_state_"),
    );
    if (!key) return null;
    const record = JSON.parse(localStorage.getItem(key));
    const entry = record && record.layers ? record.layers[id] : null;
    return entry ? { opacity: entry.opacity, overrides: entry.overrides } : null;
  };
  const registered = () => api.layers.some(l => l.id === id);

  // A plain featureGroup is user-owned and still gets the Layer section's
  // opacity row (its surface capability is "pane", not "none").
  const makeOverlay = () =>
    api.registerLayer({ id, name: "Delete Probe", layer: L.featureGroup() });
  makeOverlay();
  const row = document.querySelector(`.foliplus-layer-item[data-layer-id="${id}"]`);
  if (!row) return { error: "row not rendered", registered: registered() };
  row.querySelector(".foliplus-layer-more-btn").click();
  document
    .querySelector(
      `.foliplus-layer-item[data-layer-id="${id}"] button[data-action="style-layer"]`,
    )
    .click();
  const host = document.querySelector(".foliplus-style-opacity-track");
  if (!host) {
    return {
      error: "opacity slider not found",
      rows: document.querySelectorAll(".foliplus-layer-item[data-layer-id]").length,
    };
  }
  // Drive the real single-thumb slider: pointerdown on the thumb, pointerup
  // on the track (the release is what commits the value).
  const track = host.querySelector(".foliplus-slider-track");
  const thumb = host.querySelector(".foliplus-slider-thumb");
  const rect = track.getBoundingClientRect();
  const x = rect.left + rect.width * 0.35;
  const y = rect.top + rect.height / 2;
  const base = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: 12,
    pointerType: "mouse",
    button: 0,
  };
  thumb.dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1 }));
  track.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
  await wait(250);
  const afterSet = stored();

  // Unregister is how an empty data frame tears the layer down.
  api.unregisterLayer(id);
  await wait(250);
  const afterUnregister = stored();
  const registeredAfterUnregister = registered();

  // Data comes back, and now the user deletes the layer for good.
  makeOverlay();
  let deleteReturn = null;
  let deleteError = null;
  try {
    deleteReturn = api.deleteLayer(id);
  } catch (err) {
    deleteError = String(err && err.message ? err.message : err);
  }
  await wait(250);
  const afterDelete = stored();
  const registeredAfterDelete = registered();

  return {
    afterSet,
    afterUnregister,
    registeredAfterUnregister,
    deleteReturn,
    deleteError,
    afterDelete,
    registeredAfterDelete,
    rows: document.querySelectorAll(".foliplus-layer-item[data-layer-id]").length,
  };
};
