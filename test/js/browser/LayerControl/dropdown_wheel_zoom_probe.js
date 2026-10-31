// Opens the filter panel enum for a synthetic owner whose option list is long
// enough to be height-capped and internally scrollable, then reports the live
// wheel target (the popup's centre) and the map zoom before the wheel lands.
//
// The regression this supports: the popup is portalled out of the control
// container, so the container's disableScrollPropagation does not cover it and
// a wheel over the open list bubbles to the map container, where Leaflet's
// scrollWheelZoom fires. The Python test drives a real mouse wheel over the
// popup and asserts the map zoom is unchanged and the list stays open.
async () => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const ID = "__filter_wheel_probe__";
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
      name: "Wheel zoom",
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
  if (trigger.getAttribute("aria-expanded") !== "true") {
    trigger.click();
    await wait(40);
  }
  const list = document.querySelector(".foliplus-dropdown-list");
  if (!list) return { ok: false, reason: "no-popup" };

  // The regression the fix targets: a wheel over the open popup must not zoom the
  // map. The popup is portalled onto the covering surface. In normal mode that is
  // document.body (a sibling of the map container, so a wheel there never reaches
  // the map's handler); in pseudo/native fullscreen the surface is the map
  // container itself, so a wheel over the list bubbles to it and Leaflet's
  // scrollWheelZoom fires. Activate pseudo mode so the test covers the real case.
  const map = window.map;
  const core = window.foliplus && window.foliplus.core;
  const container = map.getContainer();
  if (core && core.fullscreen && core.fullscreen.setPseudoFullscreen) {
    core.fullscreen.setPseudoFullscreen(container, true);
    await wait(40);
  }
  const hosted = list.parentElement;
  const rect = list.getBoundingClientRect();
  return {
    ok: true,
    wheelX: rect.left + rect.width / 2,
    wheelY: rect.top + rect.height / 2,
    zoomBefore: map.getZoom(),
    popupInsideContainer: !!hosted && container.contains(hosted),
    listOpen: !list.hidden,
    listScrollable: list.scrollHeight > list.clientHeight,
    scrollTop: list.scrollTop,
    optionCount: list.querySelectorAll(".foliplus-dropdown-option").length,
  };
};
