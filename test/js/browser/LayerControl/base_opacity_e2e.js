// E2E: dragging the opacity slider on the sole visible base layer across
// the zero boundary must flip the .foliplus-no-base-map class on the map
// container.
//
// The judgement in `syncNoBasemap` is exercised directly by the JS unit
// tests (opacity 0 / 0.5 / undefined), but the browser path — slider →
// `commitOpacityPct` → `applyProjection` → `syncNoBasemap` — is a different
// chain. This probe covers the full round trip so a future refactor that
// drops the trigger leaves no-basemap visibly broken, not just a failing
// judgement. Overlay opacity is unrelated to basemap visibility and must
// not touch the class either.
() => {
  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "no __layerCtrl" };
  const map = ctrl.mgr.map;
  const api = map.foliplus.LayerAPI;
  const ui = ctrl.mgr.ui;
  const container = map.getContainer();
  const COLOR_ID = "foliplus_color_map";

  // Drag the single opacity thumb to `pct` through the primitive's real
  // pointer path: pointerdown on the thumb, pointerup on the track.
  const dragOpacity = (host, pct) => {
    const track = host.querySelector(".foliplus-slider-track");
    const thumb = host.querySelector(".foliplus-slider-thumb");
    const rect = track.getBoundingClientRect();
    const x = rect.left + rect.width * (pct / 100);
    const y = rect.top + rect.height / 2;
    const base = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 11,
      pointerType: "mouse",
      button: 0,
    };
    thumb.dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1 }));
    track.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
  };

  // LayerControl auto-registers a color basemap alongside any real tile
  // basemap; the color starts hidden (authorVisible=false) so hiding it is
  // the same visual state as not having it. Real tile basemaps are the
  // ones the user drags the opacity slider on.
  const realBases = api.layers.filter(l => l.role === "base" && l.id !== COLOR_ID);
  if (realBases.length !== 1) {
    return { error: `expected exactly 1 real tile base, got ${realBases.length}` };
  }
  const baseId = realBases[0].id;

  const setSlider = id => {
    ui.openStylePanel(id);
    const host = document.querySelector(".foliplus-style-opacity-track");
    if (!host) {
      ui.closeStylePanel(false);
      return null;
    }
    return host;
  };

  const classAt = () => container.classList.contains("foliplus-no-base-map");

  const before = { noBaseMap: classAt() };

  // 100% → 0%: sole visible basemap now visually empty, hatch should turn on.
  let r = setSlider(baseId);
  if (!r) return { error: "no opacity slider for base", before };
  dragOpacity(r, 0);
  const atZero = {
    noBaseMap: classAt(),
    liOpacity: api.layers.find(l => l.id === baseId)?.opacity,
  };
  ui.closeStylePanel(false);

  // Overlay opacity must NOT touch the class — its opacity is unrelated to
  // whether any basemap is visible, and skipping the call is deliberate on
  // the drag hot path. A bare `L.featureGroup()` has no carrier, so its
  // style panel has no opacity row; the probe needs a real layer to reach
  // the code path.
  api.registerLayer({
    id: "__e2e_ov__",
    name: "E2E Overlay",
    layer: L.marker([26.08, 119.3]),
  });
  r = setSlider("__e2e_ov__");
  if (r) dragOpacity(r, 0);
  const overlayZero = {
    noBaseMap: classAt(),
    sliderFound: !!r,
    liOpacity: api.layers.find(l => l.id === "__e2e_ov__")?.opacity,
  };
  ui.closeStylePanel(false);
  api.unregisterLayer("__e2e_ov__");

  // Reset to 100%: hatch must turn off.
  r = setSlider(baseId);
  if (r) dragOpacity(r, 100);
  const atHundred = {
    noBaseMap: classAt(),
    liOpacity: api.layers.find(l => l.id === baseId)?.opacity,
  };
  ui.closeStylePanel(false);

  return { baseId, before, atZero, overlayZero, atHundred };
};
