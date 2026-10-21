() => {
  // MeasureControl registers through createLayers: a real Leaflet layer group,
  // so its zoom-range write lands on map membership (native carrier). That
  // surface was never excluded by the canvas gate, so this probe pins the row
  // as a regression guard rather than a new capability.
  const map = window.__map;
  const api = map.foliplus.LayerAPI;
  const li = api.layers.find(l => l.id.startsWith("foliplus_measure"));
  if (!li) {
    return { error: "measure layer not registered", ids: api.layers.map(l => l.id) };
  }
  if (!li.layer) return { error: "measure layer has no Leaflet layer", id: li.id };

  // ⋮ → Style, the same two clicks a user makes.
  const row = document.querySelector(`.foliplus-layer-item[data-layer-id="${li.id}"]`);
  if (!row) return { error: "measure row not found", id: li.id };
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
  const host = zoomRow.querySelector(".foliplus-style-zoom-range-control");
  if (!host) return { error: "zoom range slider not rendered", id: li.id };

  const mapMin = Number(map.getMinZoom());
  const mapMax = Number(map.getMaxZoom());
  const current = Number(map.getZoom());
  const outMin = Math.min(mapMax, current + 1);

  // Drag one range thumb to `target` through the primitive's real pointer
  // path (pointerdown on the thumb, pointerup on the track to commit).
  const driveThumb = (index, target) => {
    const track = host.querySelector(".foliplus-slider-track");
    const thumbs = host.querySelectorAll(".foliplus-slider-thumb");
    const lo = Number(thumbs[0].getAttribute("aria-valuemin"));
    const hi = Number(thumbs[thumbs.length - 1].getAttribute("aria-valuemax"));
    const fraction = hi === lo ? 0 : (target - lo) / (hi - lo);
    const rect = track.getBoundingClientRect();
    const x = rect.left + rect.width * Math.max(0, Math.min(1, fraction));
    const y = rect.top + rect.height / 2;
    const base = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 15,
      pointerType: "mouse",
      button: 0,
    };
    thumbs[index].dispatchEvent(
      new PointerEvent("pointerdown", { ...base, buttons: 1 }),
    );
    track.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
  };

  const onMapBefore = map.hasLayer(li.layer);
  driveThumb(0, outMin);
  const onMapOut = map.hasLayer(li.layer);

  driveThumb(0, mapMin);
  const onMapBack = map.hasLayer(li.layer);

  return {
    id: li.id,
    onMapBefore,
    onMapOut,
    onMapBack,
  };
};
