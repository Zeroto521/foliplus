// Drives the filter panel's enum body on a synthetic enum owner: opens the
// panel from the row's overflow menu, toggles two options through the native
// listbox mousedown path, reads the live Result row plus the row's filtered
// count/title, then clears and reads the restored state. The owner publishes
// the same events a real component would, so the row and the panel repaint
// through the normal signal path.
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
  const select = () => panel() && panel().querySelector(".foliplus-filter-enum");
  const option = value =>
    Array.from(select().options).find(candidate => candidate.value === value) || null;
  const clickOption = value => {
    const target = option(value);
    if (!target) return false;
    target.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    return true;
  };
  const readout = () =>
    panel() ? panel().querySelector(".foliplus-filter-result") : null;
  const selectedValues = () =>
    Array.from(select() ? select().options : [])
      .filter(candidate => candidate.selected)
      .map(candidate => candidate.value);
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
    out.selectTag = select().tagName;
    out.multiple = select().multiple;
    out.size = select().getAttribute("size");
    out.optionValues = Array.from(select().options).map(candidate => candidate.value);
    out.selectedBefore = selectedValues();
    out.resultBefore = readout() ? readout().textContent : null;
    Object.assign(out, { rowBefore: rowFacts() });

    clickOption("marker");
    await wait(30);
    out.selectedAfterFirst = selectedValues();
    out.resultAfterFirst = readout() ? readout().textContent : null;
    Object.assign(out, { rowAfterFirst: rowFacts() });

    clickOption("distance");
    await wait(30);
    out.selectedAfterSecond = selectedValues();
    out.resultAfterSecond = readout() ? readout().textContent : null;
    Object.assign(out, { rowAfterSecond: rowFacts() });

    panel().querySelector(".foliplus-filter-clear").click();
    await wait(30);
    out.selectedAfterClear = selectedValues();
    out.resultAfterClear = readout() ? readout().textContent : null;
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
