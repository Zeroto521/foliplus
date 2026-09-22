async () => {
  // A canvas layer that unregisters itself keeps the user's stored opacity.
  //
  // unregisterLayer is a generic teardown, and HeatmapControl reaches it
  // whenever its data goes empty: clearHeatmapCanvas() calls
  // overlay.unregister(). Nothing about an empty frame says the user's
  // opacity should revert to the author default, so the only call that may
  // erase a value is an explicit delete.
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

  // Created the way the heatmap's overlay is: a canvas that declares its own
  // label style setters, which is what makes LayerControl render its style
  // panel at all (renderLabelControls only emits rows for the label vocabulary,
  // and a delegated drawer with no rows is dropped) — and the Layer section
  // then appends the opacity row.
  const makeOverlay = () =>
    api.createCanvas({
      id,
      name: "Delete Probe",
      styleProvider: () => ({ labelColor: "#000000", labelSize: 12 }),
      styleSetters: { labelColor: () => {}, labelSize: () => {} },
    });
  const overlay = makeOverlay();
  overlay.register();
  const row = document.querySelector(`.foliplus-layer-item[data-layer-id="${id}"]`);
  if (!row) return { error: "row not rendered", registered: registered() };
  row.querySelector(".foliplus-layer-more-btn").click();
  document
    .querySelector(
      `.foliplus-layer-item[data-layer-id="${id}"] li[data-action="style-layer"]`,
    )
    .click();
  const range = document.querySelector(".foliplus-style-opacity-range");
  if (!range) {
    return {
      error: "opacity slider not found",
      rows: document.querySelectorAll(".foliplus-layer-item[data-layer-id]").length,
    };
  }
  range.value = "35";
  range.dispatchEvent(new Event("input", { bubbles: true }));
  range.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(250);
  const afterSet = stored();

  // Unregister is how an empty data frame tears the layer down.
  overlay.unregister();
  await wait(250);
  const afterUnregister = stored();
  const registeredAfterUnregister = registered();

  // Data comes back, and now the user deletes the layer for good. deleteLayer
  // is only a live layer's action, so an already-unregistered id is refused.
  const revived = makeOverlay();
  revived.register();
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
