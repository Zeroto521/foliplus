// Geometry probe: every number under the scale must centre on the dot it
// names. The end numbers sit on the rail's end dots, the current-level number
// on its own marker dot — so the probe reports the rail's dots with their
// positions, letting the assertion compare a label's centre against its own
// dot instead of an offset. Measured in the live style panel, where the rows
// get real layout; a long label also truncates (ellipsis) instead of
// overflowing.
//
// Measured in the live style panel, where the rows get real layout. A real tile
// basemap's panel carries both slider rows, so one visit covers the single
// opacity thumb and the dual zoom-range pair (which also owns the
// current-level number).
async () => {
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
      cx: (rect.left + rect.right) / 2,
    };
  };

  const readLabel = el => {
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      text: el.textContent,
      box: boxOf(el),
      visible: style.visibility !== "hidden" && style.display !== "none",
      // Proves the ellipsis actually engages on a long label: the content's
      // intrinsic width exceeds the box the label is given.
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
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
    return {
      slider: boxOf(host),
      track: boxOf(track),
      values: boxOf(values),
      thumbs: thumbs.map(thumb => ({
        value: thumb.getAttribute("aria-valuenow"),
        box: boxOf(thumb),
      })),
      dots: [...host.querySelectorAll(".foliplus-slider-dot")].map(dot => ({
        at: dot.dataset.at,
        tone: dot.classList.contains("foliplus-slider-dot-current")
          ? "current"
          : "rail",
        box: boxOf(dot),
      })),
      labels: {
        min: readLabel(host.querySelector(".foliplus-slider-value-min")),
        max: readLabel(host.querySelector(".foliplus-slider-value-max")),
        current: readLabel(host.querySelector(".foliplus-slider-value-current")),
      },
    };
  };

  const realBases = api.layers.filter(
    layer => layer.role === "base" && layer.id !== "foliplus_color_map",
  );
  if (realBases.length !== 1) {
    return { error: `expected exactly 1 real tile base, got ${realBases.length}` };
  }

  ui.openStylePanel(realBases[0].id);
  // The style panel mounts the sliders in the same tick, but the
  // current-level label is positioned on its dot by a deferred fit
  // measure (the constructor's sync runs before the row lays out).
  // Wait two frames so that measure has run before reading geometry.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
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
