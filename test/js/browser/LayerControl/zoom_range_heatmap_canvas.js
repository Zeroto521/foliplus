() => {
  // HeatmapControl registers through createCanvas: callback-only, so its
  // zoom-range write lands on the layer's onToggle callback rather than on
  // map membership. This probe drives the row through the same two clicks a
  // user makes, then reads the canvas back to prove the write reached it.
  const map = window.map;
  const api = map && map.foliplus && map.foliplus.LayerAPI;
  const li = api && api.layers.find(l => l.id.startsWith("foliplus_heatmap"));
  if (!li) {
    return {
      error: "heatmap layer not registered",
      ids: api ? api.layers.map(l => l.id) : null,
    };
  }

  // Read before touching the panel: an untouched visit writes no zoom-range
  // record at all, so the row's absence is storage-clean rather than a
  // storage entry holding the author default.
  const key = Object.keys(localStorage).find(k =>
    k.startsWith("foliplus_layer_state_"),
  );
  const record = key ? JSON.parse(localStorage.getItem(key) || "null") : null;
  const entry = record && record.layers ? record.layers[li.id] : null;

  const pane = map.getPane(`foliplus-canvas-${li.id}`);
  const canvas = pane ? pane.querySelector("canvas.foliplus-canvas-layer") : null;
  if (!canvas) return { error: "heatmap canvas not found", id: li.id };

  // ⋮ → Style, the same two clicks a user makes.
  const row = document.querySelector(`.foliplus-layer-item[data-layer-id="${li.id}"]`);
  if (!row) return { error: "heatmap row not found", id: li.id };
  row.querySelector(".foliplus-layer-more-btn").click();
  const menuItem = document.querySelector(
    `.foliplus-layer-item[data-layer-id="${li.id}"] li[data-action="style-layer"]`,
  );
  if (!menuItem) return { error: "Style menu item not enabled", id: li.id };
  menuItem.click();
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { error: "style panel not opened", id: li.id };

  const zoomRow = panel.querySelector(".foliplus-style-zoom-range-row");
  if (!zoomRow) return { error: "zoom range row not rendered", id: li.id };

  // Drawer shape: the rows LayerControl adds read before the rows the
  // component delegated, and inside the layer section they run border,
  // opacity, zoom range.
  const all = [...panel.querySelectorAll("*")];
  const pos = node => (node ? all.indexOf(node) : -1);
  const headings = [...panel.querySelectorAll(".foliplus-section-heading")];
  // The zoom-range row node carries both classes (FORM_ROW + STYLE_ZOOM_RANGE_ROW),
  // so both shapes are collected to reach it alongside the other rows;
  // querySelectorAll returns a node only once regardless of how many of the
  // shapes match it.
  const sels = [".foliplus-form-row", ".foliplus-style-zoom-range-row"];
  const sel = sels.join(", ");
  const kindOf = n =>
    n.classList.contains("foliplus-style-zoom-range-row")
      ? "zoomRange"
      : n.querySelector(".foliplus-style-zoom-range-row")
        ? "zoomRange"
        : n.querySelector(".foliplus-style-opacity-range")
          ? "opacity"
          : n.querySelector('input[type="color"]')
            ? "border"
            : "other";
  let zoomSection = null;
  const zoomPos = pos(zoomRow);
  for (const h of headings) if (pos(h) < zoomPos) zoomSection = h.textContent;

  // Only the first section belongs to LayerControl; its controls are the ones
  // to check against the border -> opacity -> zoom range order.
  const firstHeading = headings[0];
  const firstPos = pos(firstHeading);
  const nextHeading = headings.find(h => pos(h) > firstPos);
  const end = nextHeading ? pos(nextHeading) : all.length;
  const controls = [...panel.querySelectorAll(sel)].filter(
    n => pos(n) > firstPos && pos(n) < end,
  );
  // Document-order skeleton, so a mismatch names the shape that produced it.
  const struct = [...panel.querySelectorAll(`${sel}, .foliplus-section-heading`)].map(
    n =>
      `${pos(n)}` +
      `:${n.classList.contains("foliplus-section-heading") ? "h" : kindOf(n)}` +
      `:${(n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 16)}`,
  );

  const minInput = zoomRow.querySelector(".foliplus-style-zoom-range-min");
  const mapMin = Number(map.getMinZoom());
  const mapMax = Number(map.getMaxZoom());
  const current = Number(map.getZoom());
  // Push the lower bound past the current zoom: the canvas is now out of range.
  const outMin = Math.min(mapMax, current + 1);

  // Live pass — the onToggle callback is what hides the canvas, not a map
  // write, since a canvas has no Leaflet layer to add or remove.
  const visibleBefore = !canvas.classList.contains("hidden");
  minInput.value = String(outMin);
  minInput.dispatchEvent(new Event("input", { bubbles: true }));
  const hiddenOut = canvas.classList.contains("hidden");

  // Dragging the bound back is reversible.
  minInput.value = String(mapMin);
  minInput.dispatchEvent(new Event("input", { bubbles: true }));
  const visibleBack = !canvas.classList.contains("hidden");

  // Commit pass — the out-of-range range is persisted on the real path too
  // (markOverride + saveState), behind the write debounce.
  minInput.value = String(outMin);
  minInput.dispatchEvent(new Event("change", { bubbles: true }));

  return {
    id: li.id,
    freshZoomRange: entry ? entry.zoomRange : null,
    freshOverrides: entry ? entry.overrides : null,
    sections: headings.map(h => h.textContent),
    layerControls: controls.map(kindOf),
    struct,
    zoomSection,
    visibleBefore,
    hiddenOut,
    visibleBack,
    committed: [outMin, mapMax],
  };
};
