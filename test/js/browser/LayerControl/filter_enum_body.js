// Drives the filter panel's enum body on a synthetic enum owner: opens the
// panel from the row's overflow menu, checks a type through the native
// checkbox, reads the live Result row plus the row's filtered count/title, then
// clears and reads the restored state. The owner publishes the same events a
// real component would, so the row and the panel repaint through the normal
// signal path.
async () => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const bus = window.map.foliplus && window.map.foliplus.events;
  if (!api || !bus) return null;
  const ID = "__filter_enum_probe__";
  const OPTIONS = [
    { value: "marker", label: "Marker" },
    { value: "distance", label: "Distance" },
    { value: "area", label: "Area" },
    { value: "circle", label: "Circle" },
  ];
  const TOTAL = 8;
  let filter;
  const model = () => {
    const selected =
      filter && filter.kind === "enum" ? filter.values.length : OPTIONS.length;
    return {
      dimensions: [
        { kind: "enum", field: "type", label: "Type", multi: true, options: OPTIONS },
      ],
      filter,
      kept: selected * 2,
      total: TOTAL,
    };
  };
  const notify = () => {
    bus.publish("foliplus:layer:filter-change", { id: ID });
    bus.publish("foliplus:layer:item-count-change", { id: ID });
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const row = () =>
    document.querySelector(`.foliplus-layer-item[data-layer-id="${ID}"]`);
  const panel = () => row() && row().querySelector(".foliplus-layer-filter-panel");
  const details = () => panel() && panel().querySelector(".foliplus-filter-enum");
  const summary = () =>
    panel() && panel().querySelector(".foliplus-filter-enum-trigger");
  const boxes = () =>
    panel()
      ? Array.from(
          panel().querySelectorAll(".foliplus-filter-enum-option input[type=checkbox]"),
        )
      : [];
  const valueBox = value => boxes().find(box => box.dataset.value === value) || null;
  const readout = () =>
    panel() ? panel().querySelector(".foliplus-filter-result") : null;
  const fieldLabel = () => {
    const cell = panel() && panel().querySelector(".foliplus-filter-field");
    const rowEl = cell && cell.closest(".foliplus-form-row");
    const label = rowEl && rowEl.querySelector(".foliplus-form-label");
    return label ? label.textContent : null;
  };
  const rowFacts = () => {
    const countCol = row() ? row().querySelector(".foliplus-layer-count") : null;
    return {
      title: row() ? row().getAttribute("title") : null,
      count: countCol ? countCol.textContent.trim() : null,
    };
  };
  const out = { ok: false };
  try {
    api.registerLayer({
      id: ID,
      name: "Enum probe",
      layer: L.layerGroup(),
      featureCountProvider: () => (filter ? model().kept : TOTAL),
      filterProvider: model,
      filterSetter: next => {
        filter = next;
        notify();
      },
    });
    await wait(30);
    row().querySelector(".foliplus-layer-more-btn").click();
    const menuItem = row().querySelector(
      '.foliplus-layer-more-menu [data-action="filter-layer"]',
    );
    if (!menuItem) return { ok: false, reason: "no-filter-menu-item" };
    menuItem.click();
    await wait(30);

    out.fieldLabel = fieldLabel();
    out.summaryBefore = summary() ? summary().textContent : null;
    out.detailsOpenBefore = details() ? details().open : null;
    out.resultBefore = readout() ? readout().textContent : null;
    out.optionCount = boxes().length;
    Object.assign(out, { rowBefore: rowFacts() });

    // Native disclosure: clicking the summary opens it.
    summary().click();
    await wait(10);
    out.detailsOpenAfterClick = details().open;
    out.firstOptionHitTestable = (() => {
      const box = boxes()[0];
      if (!box) return false;
      const rect = box.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return Boolean(
        hit &&
        (hit === box ||
          box.closest("label") === hit ||
          box.closest("label").contains(hit)),
      );
    })();

    // Native checkbox: clicking the input flips it and fires change.
    valueBox("marker").click();
    await wait(30);
    out.summaryAfterPick = summary() ? summary().textContent : null;
    out.resultAfterPick = readout() ? readout().textContent : null;
    out.checkedAfterPick = boxes()
      .filter(box => box.checked)
      .map(box => box.dataset.value || "all");
    Object.assign(out, { rowAfterPick: rowFacts() });

    // The disclosure stays open across a checkbox commit.
    out.detailsOpenAfterPick = details() ? details().open : null;

    panel().querySelector(".foliplus-filter-clear").click();
    await wait(30);
    out.summaryAfterClear = summary() ? summary().textContent : null;
    out.resultAfterClear = readout() ? readout().textContent : null;
    out.checkedAfterClear = boxes()
      .filter(box => box.checked)
      .map(box => box.dataset.value || "all");
    out.clearDisabled = panel().querySelector(".foliplus-filter-clear").disabled;
    Object.assign(out, { rowAfterClear: rowFacts() });
    out.ok = true;
  } finally {
    try {
      api.unregisterLayer(ID);
    } catch {
      // The probe row is best-effort cleanup; the test already read its facts.
    }
  }
  return out;
};
