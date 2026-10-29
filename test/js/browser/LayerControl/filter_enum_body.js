// Drives the filter panel's enum body on a synthetic enum owner: opens the
// panel from the row's overflow menu, opens the shared multiple dropdown,
// toggles two rows through real press events (which must toggle without
// closing the popup), reads the live Result row / trigger summary / the row's
// filtered count and title, then clears and reads the restored state. The owner
// publishes the same events a real component would, so the row and the panel
// repaint through the normal signal path.
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
    panel() &&
    panel().querySelector(".foliplus-filter-enum .foliplus-dropdown-trigger");
  const list = () => document.querySelector(".foliplus-dropdown-list");
  const optionEls = () =>
    Array.from(document.querySelectorAll(".foliplus-dropdown-option"));
  const optionRow = value =>
    optionEls().find(el => el.getAttribute("data-value") === value) || null;
  const openPopup = async () => {
    trigger().click();
    await wait(40);
  };
  /** One real press on a row: the pointerdown and mousedown must both count as
   *  inside (the popup lives on the map surface, not in the panel), then the
   *  click toggles the row without closing the popup. */
  const clickOption = async value => {
    const target = optionRow(value);
    if (!target) return false;
    target.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    target.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    target.click();
    await wait(40);
    return true;
  };
  const readout = () =>
    panel() ? panel().querySelector(".foliplus-filter-result") : null;
  const selectedValues = () =>
    optionEls()
      .filter(el => el.getAttribute("aria-selected") === "true")
      .map(el => el.getAttribute("data-value"));
  const triggerLabel = () => {
    const label = trigger() && trigger().querySelector(".foliplus-dropdown-label");
    return label ? label.textContent : null;
  };
  const popupOpen = () => Boolean(list() && list().hidden === false);
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
    await wait(40);

    out.fieldLabel = fieldLabel();
    out.triggerTag = trigger() ? trigger().tagName : null;
    out.triggerHaspopup = trigger() ? trigger().getAttribute("aria-haspopup") : null;
    out.nativeMultipleSelects = document.querySelectorAll("select[multiple]").length;
    out.panelSelects = panel() ? panel().querySelectorAll("select").length : null;
    out.labelBefore = triggerLabel();
    out.listOpenBefore = popupOpen();
    out.resultBefore = readout() ? readout().textContent : null;
    Object.assign(out, { rowBefore: rowFacts() });

    await openPopup();
    out.optionValues = optionEls().map(el => el.getAttribute("data-value"));
    out.listOpenAfterOpen = popupOpen();
    out.listParentInsidePanel = !!list() && !!panel() && panel().contains(list());
    out.selectedBefore = selectedValues();

    await clickOption("marker");
    out.selectedAfterFirst = selectedValues();
    out.labelAfterFirst = triggerLabel();
    out.listOpenAfterFirst = popupOpen();
    out.resultAfterFirst = readout() ? readout().textContent : null;
    Object.assign(out, { rowAfterFirst: rowFacts() });

    await clickOption("distance");
    out.selectedAfterSecond = selectedValues();
    out.labelAfterSecond = triggerLabel();
    out.resultAfterSecond = readout() ? readout().textContent : null;
    Object.assign(out, { rowAfterSecond: rowFacts() });

    panel().querySelector(".foliplus-filter-clear").click();
    await wait(40);
    out.selectedAfterClear = selectedValues();
    out.labelAfterClear = triggerLabel();
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
