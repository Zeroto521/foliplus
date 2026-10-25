// Geometry probe: the scale's end numbers must sit centred on the rail's
// ends — directly under the thumb that owns each end — and that centring must
// not change the control's own box. The values row takes the track's half-thumb
// inset, so the rail's ends are the values row's edges: a label centred on an
// edge overhangs by half its width, and that overhang has to land inside the
// panel's padding, not outside its scroll box.
//
// Measured in the live style panel, where the rows get real layout. A real tile
// basemap's panel carries both slider rows, so one visit covers the single
// opacity thumb and the dual zoom-range pair (which also owns the
// current-level number).
() => {
  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "no __layerCtrl" };
  const ui = ctrl.mgr.ui;
  const api = ctrl.mgr.map.foliplus.LayerAPI;

  const boxOf = el => {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      centerX: (rect.left + rect.right) / 2,
    };
  };

  const readLabel = el => {
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      text: el.textContent,
      box: boxOf(el),
      visible: style.visibility !== "hidden" && style.display !== "none",
    };
  };

  // One slider row: the two end numbers, the thumb each belongs to, and the
  // boxes whose edges the assertions read (the slider box the labels must not
  // widen, the track the thumbs ride, the values row, the panel's clip box).
  const measureRow = host => {
    const track = host.querySelector(".foliplus-slider-track");
    const values = host.querySelector(".foliplus-slider-values");
    if (!track || !values) return { error: "slider structure missing" };
    const thumbs = [...host.querySelectorAll(".foliplus-slider-thumb")];
    const content = document.querySelector(
      ".foliplus-layer-style-panel .foliplus-panel-content",
    );
    return {
      slider: boxOf(host),
      track: boxOf(track),
      values: boxOf(values),
      content: boxOf(content),
      thumbs: thumbs.map(thumb => ({
        value: thumb.getAttribute("aria-valuenow"),
        box: boxOf(thumb),
      })),
      labels: {
        min: readLabel(host.querySelector(".foliplus-slider-value-min")),
        max: readLabel(host.querySelector(".foliplus-slider-value-max")),
        current: readLabel(host.querySelector(".foliplus-slider-value-current")),
      },
    };
  };

  const realBases = api.layers.filter(
    layer => layer.group === "base" && layer.id !== "foliplus_color_map",
  );
  if (realBases.length !== 1) {
    return { error: `expected exactly 1 real tile base, got ${realBases.length}` };
  }

  ui.openStylePanel(realBases[0].id);
  const opacityHost = document.querySelector(".foliplus-style-opacity-track");
  const zoomHost = document.querySelector(".foliplus-style-zoom-range-control");
  const result = {
    error: null,
    opacity: opacityHost ? measureRow(opacityHost) : null,
    zoomRange: zoomHost ? measureRow(zoomHost) : null,
  };
  ui.closeStylePanel(false);
  return result;
};
