// P3-1 overlay-regression probe (PR #1261 rework): the filter panel's range
// slider must not show a standing bubble that covers the Field dropdown row
// above it. With the standing-bubble half reverted, the bubble exists only
// during a drag/focus gesture and hides when the gesture ends, so the field
// row is never occluded at rest. The probe registers a synthetic range-filter
// owner, opens the panel from the row's overflow menu, verifies the slider is
// really there (not a vacuous assertion), then asserts that no visible bubble
// intersects the field row's bounding box at rest and after a gesture.
async () => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const bus = window.map.foliplus && window.map.foliplus.events;
  if (!api || !bus) return null;
  const ID = "__filter_range_overlay__";
  let filter;
  const model = () => ({
    dimensions: [{ kind: "range", field: "mag", range: [0, 10], step: 1 }],
    filter,
    kept: 10,
    total: 10,
    fields: [{ value: "mag", label: "mag", numeric: true }],
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
  // The field row: the control carries data-filter-field; the row is its
  // enclosing form row (the thing a standing bubble would land on).
  const fieldRow = () => {
    const control = panel() && panel().querySelector("[data-filter-field]");
    return control && control.closest(".foliplus-form-row");
  };
  const rangeRow = () =>
    panel() && panel().querySelector('[data-filter-value="range"]');
  // The slider root IS the host: filterBody sets data-filter-value on the
  // element it passes to `new Slider`, and the constructor adds the root class
  // to that same element.
  const sliderHost = () => rangeRow();
  const bubbleEls = () => [
    ...document.querySelectorAll(".foliplus-slider-bubble"),
  ];
  const visible = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.hidden;
  };
  const intersects = (a, b) =>
    !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  const out = { ok: false };
  try {
    api.registerLayer({
      id: ID,
      name: "Range overlay probe",
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
    await wait(60);

    out.panelPresent = Boolean(panel());
    out.panelHTML = panel() ? panel().innerHTML.slice(0, 300) : null;
    out.rangeRowPresent = Boolean(rangeRow());
    out.sliderPresent = Boolean(sliderHost());
    if (!out.sliderPresent)
      return {
        ok: false,
        reason: "no-range-slider",
        panelPresent: out.panelPresent,
        rangeRowPresent: out.rangeRowPresent,
        panelHTML: out.panelHTML,
      };
    const fr = fieldRow();
    if (!fr) return { ok: false, reason: "no-field-row" };
    out.fieldRowBBox = fr.getBoundingClientRect().toJSON();
    out.fieldControlBBox = panel()
      .querySelector("[data-filter-field]")
      .getBoundingClientRect()
      .toJSON();
    out.fieldRowDisplay = getComputedStyle(fr).display;
    out.fieldRowVisible = fr.offsetParent !== null;
    out.panelContentBox = panel()
      .querySelector(".foliplus-panel-content")
      ?.getBoundingClientRect()
      .toJSON() ?? null;

    // At rest: no bubble may stand over the field row.
    out.bubblesAtRest = bubbleEls().filter(visible).map(el => {
      const r = el.getBoundingClientRect();
      return { bbox: r.toJSON(), on: el.classList.contains("is-on") };
    });
    out.fieldOverlappedAtRest = out.bubblesAtRest.some(b =>
      intersects(b.bbox, out.fieldRowBBox),
    );

    // Drive a real gesture: focus the lower thumb (keyboard is the most
    // deterministic way to show the bubble), then blur it and assert the
    // bubble hides again (nothing standing).
    const thumbs = sliderHost().querySelectorAll(".foliplus-slider-thumb");
    out.thumbCount = thumbs.length;
    if (thumbs.length > 0) {
      thumbs[0].dispatchEvent(new Event("focus"));
      await wait(20);
      out.bubblesOnFocus = bubbleEls().filter(visible).map(el => {
        const r = el.getBoundingClientRect();
        return { bbox: r.toJSON(), on: el.classList.contains("is-on") };
      });
      out.fieldOverlappedOnFocus = out.bubblesOnFocus.some(b =>
        intersects(b.bbox, out.fieldRowBBox),
      );
      thumbs[0].dispatchEvent(new Event("blur"));
      await wait(20);
      out.bubblesAfterBlur = bubbleEls().filter(visible).map(el => ({
        on: el.classList.contains("is-on"),
      }));
    }

    out.ok = true;
  } catch (err) {
    out.error = String(err && err.stack ? err.stack : err);
  }
  return out;
};
