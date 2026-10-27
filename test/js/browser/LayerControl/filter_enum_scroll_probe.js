// Opens the filter panel for an enum owner with more options than the listbox
// size cap, so the test can assert the native list scrolls internally.
async () => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const bus = window.map.foliplus && window.map.foliplus.events;
  if (!api || !bus) return null;
  const ID = "__filter_enum_scroll_probe__";
  const VALUES = ["a", "b", "c", "d", "e", "f"];
  let filter;
  const model = () => ({
    dimensions: [
      {
        kind: "enum",
        field: "kind",
        label: "Kind",
        multi: true,
        options: VALUES.map(value => ({ value, label: value.toUpperCase() })),
      },
    ],
    filter,
    kept: 6,
    total: 6,
  });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const existing = document.querySelector(
    `.foliplus-layer-item[data-layer-id="${ID}"]`,
  );
  if (!existing) {
    api.registerLayer({
      id: ID,
      name: "Enum scroll",
      layer: L.layerGroup(),
      filterProvider: model,
      filterSetter: next => {
        filter = next;
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
  const select = row.querySelector(".foliplus-filter-enum");
  if (!select) return { ok: false, reason: "no-listbox" };
  return {
    ok: true,
    size: select.getAttribute("size"),
    optionValues: Array.from(select.options).map(option => option.value),
    scroll: { client: select.clientHeight, scroll: select.scrollHeight },
  };
};
