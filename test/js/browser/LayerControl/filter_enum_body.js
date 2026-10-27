// Drives the filter panel's enum body on a synthetic enum owner: opens the
// panel from the row's overflow menu, selects a type, reads the live Result row
// plus the row's filtered count/title, then clears and reads the restored
// state. The owner publishes the same events a real component would, so the
// row and the panel repaint through the normal signal path.
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
  const trigger = () =>
    panel() && panel().querySelector(".foliplus-filter-enum-trigger");
  const options = () =>
    panel() ? Array.from(panel().querySelectorAll(".foliplus-filter-enum-option")) : [];
  const readout = () =>
    panel() ? panel().querySelector(".foliplus-filter-result") : null;
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

    out.triggerBefore = trigger() ? trigger().textContent : null;
    out.resultBefore = readout() ? readout().textContent : null;
    Object.assign(out, { rowBefore: rowFacts() });

    trigger().click();
    await wait(10);
    out.expanded = trigger().getAttribute("aria-expanded");
    out.listMultiselectable = panel()
      .querySelector(".foliplus-filter-enum-list")
      .getAttribute("aria-multiselectable");
    out.optionCount = options().length;

    options()[0].click();
    await wait(30);
    out.triggerAfterPick = trigger().textContent;
    out.resultAfterPick = readout() ? readout().textContent : null;
    out.selectedAfterPick = options().map(option =>
      option.getAttribute("aria-selected"),
    );
    Object.assign(out, { rowAfterPick: rowFacts() });

    panel().querySelector(".foliplus-filter-clear").click();
    await wait(30);
    out.triggerAfterClear = trigger() ? trigger().textContent : null;
    out.resultAfterClear = readout() ? readout().textContent : null;
    out.selectedAfterClear = options().map(option =>
      option.getAttribute("aria-selected"),
    );
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
