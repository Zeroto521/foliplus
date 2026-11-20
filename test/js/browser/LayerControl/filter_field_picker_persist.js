// Drives the filter panel's field picker on a multi-field owner and pins the
// P1 regression: switching from a range field to an enum field must keep the
// field row (the panel still answers "which field"), and the field / value
// rows must be addressable by their stable data-* identity, not by a shared
// class that a multi-condition tree could reuse.
async () => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const bus = window.map.foliplus && window.map.foliplus.events;
  if (!api || !bus) return null;
  const ID = "__filter_field_picker__";
  let filter;
  const model = () => ({
    dimensions: [
      { kind: "range", field: "mag", range: [0, 10], step: 1 },
      {
        kind: "enum",
        field: "kind",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
        multi: true,
      },
    ],
    filter,
    kept: 10,
    total: 10,
    fields: [
      { value: "mag", label: "mag", numeric: true },
      { value: "kind", label: "kind", numeric: false },
    ],
    onField: () => {
      filter = undefined;
      notify();
    },
  });
  const notify = () => {
    bus.publish("foliplus:layer:filter-change", { id: ID });
    bus.publish("foliplus:layer:item-count-change", { id: ID });
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const row = () =>
    document.querySelector(`.foliplus-layer-item[data-layer-id="${ID}"]`);
  const panel = () => row() && row().querySelector(".foliplus-layer-filter-panel");
  const fieldRow = () => panel() && panel().querySelector("[data-filter-field]");
  const valueRowRange = () =>
    panel() && panel().querySelector('[data-filter-value="range"]');
  const valueRowEnum = () =>
    panel() && panel().querySelector('[data-filter-value="enum"]');
  const out = { ok: false };
  try {
    api.registerLayer({
      id: ID,
      name: "Field picker probe",
      layer: L.layerGroup(),
      featureCountProvider: () => 10,
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
    await wait(40);

    // Range state: field row data-filter-field=mag, value row range.
    out.initialField = fieldRow() ? fieldRow().getAttribute("data-filter-field") : null;
    out.initialFieldLabel = fieldRow()
      ? fieldRow().closest(".foliplus-form-row").querySelector(".foliplus-form-label")
          .textContent
      : null;
    out.initialValueRange = Boolean(valueRowRange());
    out.initialFieldCount = panel()
      ? panel().querySelectorAll("[data-filter-field]").length
      : -1;
    out.initialValueCount = panel()
      ? panel().querySelectorAll("[data-filter-value]").length
      : -1;
    out.initialSelectValue = fieldRow()
      ? fieldRow().querySelector("select").value
      : null;

    // Switch to the enum field.
    const select = fieldRow() && fieldRow().querySelector("select");
    if (!select) return { ok: false, reason: "no-field-select" };
    select.value = "kind";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(40);

    // The P1: the field row must survive the switch, now carrying kind.
    out.afterField = fieldRow() ? fieldRow().getAttribute("data-filter-field") : null;
    out.afterValueEnum = Boolean(valueRowEnum());
    out.afterValueRange = Boolean(valueRowRange());
    out.afterFieldCount = panel()
      ? panel().querySelectorAll("[data-filter-field]").length
      : -1;
    out.afterValueCount = panel()
      ? panel().querySelectorAll("[data-filter-value]").length
      : -1;
    out.afterSelectValue = fieldRow() ? fieldRow().querySelector("select").value : null;
    out.afterSelectOptions = fieldRow()
      ? Array.from(fieldRow().querySelector("select").options).map(o => o.value)
      : null;

    // The field row precedes the value row.
    const rows = panel()
      ? Array.from(panel().querySelectorAll(".foliplus-form-row"))
      : [];
    const fieldRowEl = fieldRow() && fieldRow().closest(".foliplus-form-row");
    const valueRowEl = valueRowEnum() && valueRowEnum().closest(".foliplus-form-row");
    out.fieldBeforeValue = Boolean(
      fieldRowEl && valueRowEl && rows.indexOf(fieldRowEl) < rows.indexOf(valueRowEl),
    );
    out.ok = true;
  } finally {
    try {
      api.unregisterLayer(ID);
    } catch {
      // best-effort cleanup
    }
  }
  return out;
};
