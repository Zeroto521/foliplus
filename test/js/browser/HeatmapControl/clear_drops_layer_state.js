async () => {
  // Both clear entries must erase the LayerControl-side record.
  //
  // The heatmap persists its own config under its own key, while the row's
  // opacity and visibility live under LayerControl's key. A redraw of the same
  // id used to inherit the tuning the user had arranged for the previous draw —
  // and a reload resurrected it as well. Both the panel's Clear button and the
  // row menu's Clear Data must drop their half, or the redraw inherits the half
  // nobody pruned.
  const api = window.map && window.map.foliplus && window.map.foliplus.LayerAPI;
  const hm = window.__heatmapCtrl;
  if (!api) return { error: "no LayerAPI" };
  if (!hm) return { error: "heatmap control not exposed" };

  // Writes are debounced (SAVE_DEBOUNCE_MS), so every read waits past the flush.
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const lid = () => hm.mgr.layerId;

  const stored = () => {
    const key = Object.keys(localStorage).find(k =>
      k.startsWith("foliplus_layer_state_"),
    );
    if (!key) return null;
    const record = JSON.parse(localStorage.getItem(key));
    const entry = record && record.layers ? record.layers[lid()] : null;
    if (!entry) return null;
    return {
      visible: "visible" in entry ? entry.visible : null,
      opacity: "opacity" in entry ? entry.opacity : null,
      overrides: entry.overrides || [],
    };
  };

  const rowOf = () =>
    document.querySelector(`.foliplus-layer-item[data-layer-id="${lid()}"]`);

  const openPanel = async () => {
    const shell = document.querySelector(".foliplus-heatmap-ctrl");
    if (
      shell &&
      shell.classList.contains("foliplus-is-expanded") &&
      !shell.classList.contains("foliplus-is-collapsed")
    ) {
      return true;
    }
    document.querySelector(".foliplus-heatmap-ctrl .foliplus-toggle-btn").click();
    await wait(250);
    return true;
  };

  const redraw = async () => {
    const options = Array.from(hm.layerSelect.querySelectorAll("option"))
      .map(o => o.value)
      .filter(v => !!v);
    if (!options.length) return false;
    hm.layerSelect.value = options[0];
    hm.layerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(300);
    return true;
  };

  // Opacity first: an unchecked row disables its Style entry.
  const setTuning = async () => {
    const row = rowOf();
    if (!row) return "no-row";
    row.querySelector(".foliplus-layer-more-btn").click();
    await wait(120);
    const li = document.querySelector(
      `.foliplus-layer-item[data-layer-id="${lid()}"] li[data-action="style-layer"]`,
    );
    if (!li || li.getAttribute("disabled")) return "style-disabled";
    li.click();
    await wait(120);
    const range = document.querySelector(".foliplus-style-opacity-range");
    if (!range) return "no-slider";
    range.value = "35";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(250);

    const cb = rowOf().querySelector('input[type="checkbox"]');
    if (cb && cb.checked) {
      cb.click();
      await wait(250);
    }
    return "ok";
  };

  const clickClearButton = async () => {
    const btn = document.querySelector("[data-heatmap-btn-clear]");
    if (!btn) return false;
    btn.click();
    await wait(300);
    return true;
  };

  const clickMenuDelete = async () => {
    const row = rowOf();
    if (!row) return false;
    row.querySelector(".foliplus-layer-more-btn").click();
    await wait(120);
    const find = () =>
      document.querySelector(
        `.foliplus-layer-item[data-layer-id="${lid()}"] li[data-action="delete-layer"]`,
      );
    const armed = find();
    if (!armed) return false;
    armed.click(); // first click arms
    await wait(200);
    (find() || armed).click(); // second click confirms
    await wait(300);
    return true;
  };

  const round = async action => {
    await openPanel();
    await redraw();
    const tuning = await setTuning();
    const afterSet = stored();

    await openPanel();
    const ran = await action();

    await openPanel();
    await redraw();
    const cb = (() => {
      const row = rowOf();
      return row && row.querySelector('input[type="checkbox"]');
    })();
    return {
      tuning,
      ran,
      afterSet,
      afterClear: stored(),
      afterRedraw: stored(),
      checkboxAfterRedraw: cb ? cb.checked : null,
    };
  };

  return {
    clearButton: await round(clickClearButton),
    menuDelete: await round(clickMenuDelete),
  };
};
