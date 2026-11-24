async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, ms = 2000, step = 25) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await wait(step);
    }
  };
  // The row-layout probe reads a real dropdown option row, so the filter panel
  // must render an ENUM body (which carries the shared dropdown). The layers
  // under test here (FeatureGroup + GeoJson) only yield a range dimension — a
  // slider, not a dropdown — so seed a synthetic enum-capable layer the way the
  // enum filter tests do (open_enum_dropdown.js) rather than expecting the
  // GeoJson's numeric field to produce a dropdown trigger.
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return false;
  const ID = "__row_layout_probe__";
  const VALUES = ["a", "b", "c"];
  let filter;
  const model = () => ({
    dimensions: [
      {
        kind: "enum",
        field: "kind",
        label: "Kind",
        multi: true,
        options: VALUES.map(v => ({ value: v, label: v.toUpperCase() })),
      },
    ],
    filter,
    kept: VALUES.length,
    total: VALUES.length,
  });
  api.registerLayer({
    id: ID,
    name: "Row layout probe",
    layer: L.layerGroup(),
    filterProvider: model,
    filterSetter: next => {
      filter = next;
    },
  });
  await wait(30);
  const rowSelector = ".foliplus-layer-item[data-layer-id=\"" + ID + "\"]";
  const row = document.querySelector(rowSelector);
  if (!row) return false;
  const more = row.querySelector(".foliplus-layer-more-btn");
  if (!more) return false;
  more.click();
  const menuItem = await until(() =>
    row.querySelector('.foliplus-layer-more-menu [data-action="filter-layer"]'),
  );
  if (!menuItem) return false;
  menuItem.click();
  const panel = await until(() =>
    row.querySelector(".foliplus-layer-filter-panel"),
  );
  if (!panel) return false;
  // A reference row built from the same primitive, to compare geometry against.
  const ref = document.createElement("div");
  ref.className = "row-layout-ref";
  const refRow = document.createElement("div");
  refRow.className = "foliplus-row";
  const refContent = document.createElement("div");
  refContent.className = "foliplus-row-content";
  refContent.textContent = "Reference";
  refRow.appendChild(refContent);
  ref.appendChild(refRow);
  document.body.appendChild(ref);
  const trigger = panel.querySelector(
    ".foliplus-filter-enum .foliplus-dropdown-trigger",
  );
  if (!trigger) return false;
  trigger.click();
  const option = await until(() =>
    document.querySelector(".foliplus-dropdown-option.foliplus-row"),
  );
  return !!(option && document.querySelector(".row-layout-ref .foliplus-row"));
};
