// Opens the ⋮ → Style panel for one layer row, writes the layer's pixel radius
// through the row's own Size input when given, and reports the panel contents,
// what every pixel-radius leaf on the map is actually drawing, and the
// persisted record.
//
// Passing the radius through the row's input instead of calling setRadius is
// the point: this is the exact path a user takes. A null size leaves the input
// untouched, so the same snippet reads the panel back (e.g. to check the row
// renders at all for a Polygon, where it must not).
//
// One round trip: the panel opens synchronously on the menu click, so there is
// no driver-side wait between opening it and writing to it. Rows are matched by
// id first, then by the name a folium layer was declared with — folium names
// its ids independently of the label the panel shows.
//
// A truthy `reset` clicks the panel's own Reset instead of writing, so one
// round trip can cover "set size → reset → read radius". Reset closes the panel
// and restores the author's radius from the write path's own cache, so the
// report reads the map and the storage rather than the panel's fields.
//
// The leaves are walked from the whole map, not just this row's layer: a radius
// write that leaked into a sibling layer would show up here too. A Polygon has
// no pixel-radius leaf, so a map holding only polygons reports an empty list —
// which is exactly what the "no row for a Polygon" assertion needs.
//
// A size write reaches the leaves through the shared frame coalescer
// (scheduleStyleDimApply -> throttleRaf), so the map read must outwait that
// frame: a same-tick read would report the radius the walk was about to
// paint. Reset walks its leaves synchronously, so the same wait is harmless
// there. Storage is read after the persistence debounce, because a same-tick
// read would report the pre-write record and look like a lost save.
//
// Page.evaluate takes one argument, so the three arrive as a list. An omitted
// tail stays undefined, which is what the read-only calls rely on.
async ([layerName, size, reset] = []) => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const byName =
    api && Array.isArray(api.layers)
      ? api.layers.find(l => l.name === layerName)
      : undefined;

  let row = document.querySelector(
    `[data-layer-id="${CSS.escape(layerName)}"][data-layer-type]`,
  );
  if (!row && byName && byName.id) {
    row = document.querySelector(
      `[data-layer-id="${CSS.escape(byName.id)}"][data-layer-type]`,
    );
  }
  if (!row) {
    const rows = document.querySelectorAll(
      `[data-layer-type]:not([data-layer-type="base"])`,
    );
    row = Array.from(rows).find(r => r.textContent.includes(layerName));
  }
  if (!row) return { row: false, layers: api ? api.layers.map(l => l.id) : null };

  row.querySelector(".foliplus-layer-more-btn").click();
  const styleItem = row.querySelector(
    '.foliplus-layer-more-menu li[data-action="style-layer"]',
  );
  if (!styleItem) return { row: true, styleItem: false };
  styleItem.click();

  const panel = row.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { row: true, styleItem: true, panel: false };

  const sizeRow = panel.querySelector(".foliplus-style-size-row");
  const setSize = panel.querySelector(".foliplus-style-size-input");

  let wrote = false;
  if (reset) {
    const resetBtn = panel.querySelector(".foliplus-style-reset-btn");
    if (resetBtn) {
      resetBtn.click();
      wrote = true;
    }
  } else if (setSize && size !== null && size !== undefined) {
    setSize.value = String(size);
    setSize.dispatchEvent(new Event("input", { bubbles: true }));
    setSize.dispatchEvent(new Event("change", { bubbles: true }));
    wrote = true;
  }

  // A pixel-radius leaf, read off the carrier the write path itself recognises:
  // getRadius + setRadius + numeric _radius, and no _mRadius. _mRadius is the
  // discriminator that keeps L.Circle out (a metre radius is not a pixel one),
  // so reading it back is honest about what the panel can actually write to.
  const isPixelRadiusLeaf = n =>
    !!n &&
    typeof n.getRadius === "function" &&
    typeof n.setRadius === "function" &&
    typeof n._radius === "number" &&
    n._mRadius === undefined;
  const leaves = [];
  const seen = new Set();
  const walk = node => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (isPixelRadiusLeaf(node)) {
      const el = typeof node.getElement === "function" ? node.getElement() : null;
      const d = el ? el.getAttribute("d") : null;
      // Leaflet's SVG renderer draws a CircleMarker as a <path> arc, not a
      // <circle>, so there is no r attribute: the radius rides the arc's own
      // parameters. Report both and derive one number either way, so the test
      // has a single "what the SVG is painting" field to assert against.
      const arc = d ? d.match(/[aA]\s*([\d.]+)\s*,\s*([\d.]+)/) : null;
      const r = el ? el.getAttribute("r") : null;
      // One number either way: the r attribute when the renderer paints a
      // <circle>, else the radius the path arc carries.
      let svgRadius = null;
      if (r !== null) {
        svgRadius = Number(r);
      } else if (arc) {
        svgRadius = Number(arc[1]);
      }
      leaves.push({
        radius: node.getRadius(),
        r,
        d,
        tag: el ? el.tagName : null,
        svgRadius,
      });
    }
    if (typeof node.eachLayer === "function") node.eachLayer(walk);
  };
  // The field's value is only meaningful before a reset: Reset closes the panel
  // and its fields leave the document, so a detached read would report a stale
  // number instead of the honest "no field".
  const input = setSize && !reset ? setSize.value : null;

  if (wrote) {
    // The size apply walk rides throttleRaf (one animation frame) and the
    // persistence write debounces SAVE_DEBOUNCE_MS (100 ms), so one round trip
    // must outwait both before it reports the map and the storage.
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  window.map.eachLayer(walk);

  // The storage key carries the map's own suffix, so the test never has to
  // know it. The entry is keyed by the row's data-layer-id, with a fallback to
  // the id folium's own registry assigned to the name.
  const key = Object.keys(localStorage).find(k =>
    k.startsWith("foliplus_layer_state_"),
  );
  const record = key ? JSON.parse(localStorage.getItem(key) || "null") : null;
  const layers = record && record.layers ? record.layers : {};
  const rowId = row.getAttribute("data-layer-id");
  const entry = layers[rowId] ?? (byName && byName.id ? layers[byName.id] : null);

  return {
    row: true,
    panel: true,
    id: rowId,
    sizeRow: !!sizeRow,
    sizeRows: panel.querySelectorAll(".foliplus-style-size-row").length,
    sizeInput: input,
    labels: Array.from(panel.querySelectorAll(".foliplus-form-label")).map(
      el => el.textContent,
    ),
    leaves,
    storage: entry,
  };
};
