// Option-label ellipsis regression guard (row-primitive PR1, P2-1).
//
// After the dropdown option row migrated into the shared row primitive, the
// option label (.foliplus-dropdown-option-label) moved from a direct flex item
// of the option button into .foliplus-row-content, which is NOT a flex
// container. An inline element's overflow:hidden is ignored, so the label's
// text-overflow: ellipsis became dead code and a long label overflows the
// popup instead of ellipsizing.
//
// The probe registers a synthetic enum owner whose single option label is long
// enough to overflow the popup, opens the filter dropdown, and reports whether
// the label's content overflows its box (scrollWidth > clientWidth). That is
// the exact condition ellipsis clipping establishes: TRUE only when
// overflow:hidden actually clips (a block label), FALSE when the label is an
// unclipped inline. jsdom cannot lay out, so this is a browser probe driven by
// test/python/control/LayerControl/test_row_layout.py.
//
// The interaction chain uses poll-until waits instead of fixed sleeps so a
// slow CI runner cannot miss a menu/panel/option render between steps.
async () => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const bus = window.map.foliplus && window.map.foliplus.events;
  if (!api || !bus) return null;
  const ID = "__row_label_ellipsis_probe__";
  const LONG = "Natural Breaks classification with a deliberately long display name";
  let filter;
  const model = () => ({
    dimensions: [
      {
        kind: "enum",
        field: "kind",
        label: "Kind",
        multi: true,
        options: [{ value: "nb", label: LONG }],
      },
    ],
    filter,
    kept: 1,
    total: 1,
  });
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
  const row = () =>
    document.querySelector(`.foliplus-layer-item[data-layer-id="${ID}"]`);
  try {
    if (!(await until(row, 1000))) {
      api.registerLayer({
        id: ID,
        name: "Row label ellipsis",
        layer: L.layerGroup(),
        filterProvider: model,
        filterSetter: next => {
          filter = next;
        },
      });
      await until(row, 1000);
    }
    row().querySelector(".foliplus-layer-more-btn").click();
    const menuItem = await until(() =>
      row().querySelector('.foliplus-layer-more-menu [data-action="filter-layer"]'),
    );
    if (!menuItem) return { ok: false, reason: "no-menu-item" };
    menuItem.click();
    const panel = await until(() =>
      row().querySelector(".foliplus-layer-filter-panel"),
    );
    const trigger = await until(
      () =>
        panel &&
        panel.querySelector(".foliplus-filter-enum .foliplus-dropdown-trigger"),
    );
    if (!trigger) return { ok: false, reason: "no-trigger" };
    trigger.click();
    const option = await until(() =>
      document.querySelector(".foliplus-dropdown-option"),
    );
    const label = option && option.querySelector(".foliplus-dropdown-option-label");
    const content = option && option.querySelector(".foliplus-row-content");
    if (!label || !content) return { ok: false, reason: "no-label" };
    const cs = getComputedStyle(label);
    const optionRect = option.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    return {
      ok: true,
      labelDisplay: cs.display,
      labelOverflow: cs.overflow,
      labelTextOverflow: cs.textOverflow,
      overflows: label.scrollWidth > label.clientWidth,
      scrollW: label.scrollWidth,
      clientW: label.clientWidth,
      // The clipped label must stay inside the option button's right edge.
      labelInsideRow: labelRect.right <= optionRect.right + 0.5,
      optionWidth: optionRect.width,
      labelWidth: labelRect.width,
      contentWidth: contentRect.width,
      contentOverflow: getComputedStyle(content).overflow,
    };
  } finally {
    api.unregisterLayer(ID);
  }
};
