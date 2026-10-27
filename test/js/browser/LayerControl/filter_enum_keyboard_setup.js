// Opens the filter panel for a synthetic enum owner and parks focus on the
// native listbox, so the Python test can drive the real browser keyboard path
// (Playwright key events, not synthetic DOM events).
async () => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const bus = window.map.foliplus && window.map.foliplus.events;
  if (!api || !bus) return null;
  const ID = "__filter_enum_keyboard_probe__";
  const OPTIONS = [
    { value: "marker", label: "Marker" },
    { value: "distance", label: "Distance" },
    { value: "area", label: "Area" },
    { value: "circle", label: "Circle" },
  ];
  let filter;
  const model = () => ({
    dimensions: [
      { kind: "enum", field: "type", label: "Type", multi: true, options: OPTIONS },
    ],
    filter,
    kept: filter && filter.kind === "enum" ? filter.values.length * 2 : 8,
    total: 8,
  });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const existing = document.querySelector(
    `.foliplus-layer-item[data-layer-id="${ID}"]`,
  );
  if (!existing) {
    api.registerLayer({
      id: ID,
      name: "Enum keyboard",
      layer: L.layerGroup(),
      filterProvider: model,
      filterSetter: next => {
        filter = next;
        bus.publish("foliplus:layer:filter-change", { id: ID });
        bus.publish("foliplus:layer:item-count-change", { id: ID });
      },
    });
    await wait(30);
  }
  const row = document.querySelector(`.foliplus-layer-item[data-layer-id="${ID}"]`);
  if (!row) return { ok: false, reason: "no-row" };
  row.querySelector(".foliplus-layer-more-btn").click();
  const menuItem = row.querySelector(
    '.foliplus-layer-more-menu [data-action="filter-layer"]',
  );
  if (!menuItem) return { ok: false, reason: "no-filter-menu-item" };
  menuItem.click();
  await wait(30);
  const panel = row.querySelector(".foliplus-layer-filter-panel");
  const select = panel && panel.querySelector(".foliplus-filter-enum");
  if (!select) return { ok: false, reason: "no-listbox" };
  select.focus();
  return {
    ok: true,
    id: ID,
    selectSize: select.getAttribute("size"),
    optionValues: Array.from(select.options).map(option => option.value),
  };
};
