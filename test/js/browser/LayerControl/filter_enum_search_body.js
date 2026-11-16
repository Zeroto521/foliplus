// Drives the filter panel's enum search on a synthetic enum owner: registers a
// layer whose enum domain is 40 values and marked truncated (the panel shows a
// search box), opens the panel, opens the shared multiple dropdown, types into
// the search input, verifies the filtered rows (including a value past the
// display cap), selects a row past the cap, and reads the committed filter.
async () => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const bus = window.map.foliplus && window.map.foliplus.events;
  if (!api || !bus) return null;
  const ID = "__filter_enum_search_probe__";
  const OPTIONS = Array.from({ length: 40 }, (_, i) => ({
    value: "value-" + String(i),
    label: "Value " + String(i),
  }));
  const TOTAL = 80;
  let filter;
  const model = () => {
    const selected =
      filter && filter.kind === "enum" ? filter.values.length : OPTIONS.length;
    return {
      dimensions: [
        {
          kind: "enum",
          field: "kind",
          multi: true,
          options: OPTIONS,
          truncated: true,
          total: OPTIONS.length,
        },
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
    panel() &&
    panel().querySelector(".foliplus-filter-enum .foliplus-dropdown-trigger");
  const list = () => document.querySelector(".foliplus-dropdown-list");
  const optionEls = () =>
    Array.from(document.querySelectorAll(".foliplus-dropdown-option"));
  const searchInput = () => document.querySelector(".foliplus-dropdown-search input");
  const status = () => document.querySelector('[role="status"]');
  const out = { ok: false };
  try {
    api.registerLayer({
      id: ID,
      name: "Enum search probe",
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
    await wait(40);

    // The truncated domain gets a search box (threshold <= 30 values).
    out.searchBefore = Boolean(searchInput());
    out.optionCountBefore = optionEls().length;

    trigger().click();
    await wait(60);

    out.searchAfterOpen = Boolean(searchInput());
    out.listOpen = Boolean(list() && list().hidden === false);
    // With no query, the engine renders at most the render limit (30).
    out.optionCountNoQuery = optionEls().length;

    // Type a query that matches only the tail of the domain (past the cap).
    const input = searchInput();
    input.value = "Value 39";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(250); // debounce

    out.optionCountFiltered = optionEls().length;
    out.filteredValue = optionEls()[0]
      ? optionEls()[0].getAttribute("data-value")
      : null;
    out.statusText = status() ? status().textContent : null;

    // Select the row past the display cap (it is renderable via search).
    const target = optionEls().find(el => el.getAttribute("data-value") === "value-39");
    if (target) {
      target.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      target.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      target.click();
      await wait(40);
    }
    out.selected = filter ? filter.values : null;
    out.selectedCount = filter ? filter.values.length : 0;
    out.ok = true;
  } finally {
    try {
      api.unregisterLayer(ID);
    } catch {
      // Best-effort cleanup; the test already read its facts.
    }
  }
  return out;
};
