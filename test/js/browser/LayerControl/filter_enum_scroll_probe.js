// Opens the filter panel for an enum owner with more options than the shared
// dropdown shows at once, so the test can assert the portalled popup is
// height-capped and scrolls internally instead of running past the viewport.
async () => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const bus = window.map.foliplus && window.map.foliplus.events;
  if (!api || !bus) return null;
  const ID = "__filter_enum_scroll_probe__";
  const VALUES = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
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
    kept: VALUES.length,
    total: VALUES.length,
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
  await wait(40);
  const panel = row.querySelector(".foliplus-layer-filter-panel");
  const trigger =
    panel && panel.querySelector(".foliplus-filter-enum .foliplus-dropdown-trigger");
  if (!trigger) return { ok: false, reason: "no-dropdown-trigger" };
  trigger.click();
  await wait(40);
  const list = document.querySelector(".foliplus-dropdown-list");
  if (!list) return { ok: false, reason: "no-popup" };
  return {
    ok: true,
    triggerTag: trigger.tagName,
    optionValues: Array.from(
      document.querySelectorAll(".foliplus-dropdown-option"),
    ).map(el => el.getAttribute("data-value")),
    scroll: { client: list.clientHeight, scroll: list.scrollHeight },
    maxHeight: getComputedStyle(list).maxHeight,
    popupParentTag: list.parentElement ? list.parentElement.tagName : null,
    popupInsidePanel: panel.contains(list),
  };
};
