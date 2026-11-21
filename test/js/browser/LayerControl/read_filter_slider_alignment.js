// Geometry probe for the filter panel's range slider. Registers two range
// owners — one with a one-column min / long max and one with both ends long —
// and measures the end labels against the control's edges (a label no wider
// than the thumb centres on the parked dot's centre = the control edge; a
// label wider than the thumb clamps to the control's edge), so a regression
// test can assert the rendered-width alignment rule.
async () => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const bus = window.map.foliplus && window.map.foliplus.events;
  if (!api || !bus) return { error: "no api/bus" };
  const boxOf = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, cx: (r.left + r.right) / 2 };
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const readOne = async (id, name, range) => {
    let filter;
    const model = () => ({
      dimensions: [{ kind: "range", field: "mag", range, step: 1 }],
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
      bus.publish("foliplus:layer:filter-change", { id });
      bus.publish("foliplus:layer:item-count-change", { id });
    };
    const row = () =>
      document.querySelector('.foliplus-layer-item[data-layer-id="' + id + '"]');
    const panel = () => row() && row().querySelector(".foliplus-layer-filter-panel");
    api.registerLayer({
      id,
      name,
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
    if (!menuItem) return { error: "no-filter-menu-item" };
    menuItem.click();
    await wait(60);
    const sliderHost = panel() && panel().querySelector(".foliplus-slider");
    if (!sliderHost) return { error: "no filter slider" };
    const track = sliderHost.querySelector(".foliplus-slider-track");
    const values = sliderHost.querySelector(".foliplus-slider-values");
    const thumb = sliderHost.querySelector(".foliplus-slider-thumb");
    const minEl = sliderHost.querySelector(".foliplus-slider-value-min");
    const maxEl = sliderHost.querySelector(".foliplus-slider-value-max");
    return {
      error: null,
      values: boxOf(values),
      track: boxOf(track),
      thumb: boxOf(thumb),
      min: {
        ...boxOf(minEl),
        text: minEl.textContent,
        clamp: minEl.classList.contains("is-clamp"),
      },
      max: {
        ...boxOf(maxEl),
        text: maxEl.textContent,
        clamp: maxEl.classList.contains("is-clamp"),
      },
    };
  };
  try {
    const mixed = await readOne("__filter_mixed_probe__", "Mixed probe", [0, 10000]);
    const both = await readOne("__filter_both_probe__", "Both probe", [5860, 28654]);
    return { error: null, mixed, both };
  } catch (e) {
    return { error: String(e) };
  }
};
