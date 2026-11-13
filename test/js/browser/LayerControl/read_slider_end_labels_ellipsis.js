// Kill-test probe for the end-number ellipsis contract: a long value label
// must truncate (ellipsis) rather than paint past the values row, and a short
// label must not be truncated. The slider is appended into the live style
// panel so its clip ancestor is the real panel content; the probe reads each
// label's intrinsic (scroll) width against its box (client) width and both
// rects against the values row's box.
() => {
  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "no __layerCtrl" };
  const ui = ctrl.mgr.ui;
  const api = ctrl.mgr.map.foliplus.LayerAPI;
  const boxOf = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  };
  const realBases = api.layers.filter(
    l => l.role === "base" && l.id !== "foliplus_color_map",
  );
  if (realBases.length !== 1) return { error: "expected 1 real base" };
  ui.openStylePanel(realBases[0].id);
  const opacityHost = document.querySelector(".foliplus-style-opacity-track");
  const parent = opacityHost.parentElement;
  const host = document.createElement("div");
  host.style.width = opacityHost.getBoundingClientRect().width + "px";
  parent.appendChild(host);
  const read = h => {
    const values = h.querySelector(".foliplus-slider-values");
    const minEl = h.querySelector(".foliplus-slider-value-min");
    const maxEl = h.querySelector(".foliplus-slider-value-max");
    const readLabel = el => {
      if (!el) return null;
      return {
        text: el.textContent,
        box: boxOf(el),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    };
    return { values: boxOf(values), min: readLabel(minEl), max: readLabel(maxEl) };
  };
  const result = {};
  const build = (name, min, max) => {
    host.innerHTML = "";
    new window.foliplus.ui.Slider(host, {
      min: 0,
      max: 100,
      value: [0, 100],
      label: "probe",
      values: { min, max },
      format: n => String(n),
    });
    result[name] = read(host);
  };
  build("long", "2026年11月13日 00:00", "2026年11月20日 23:30");
  build("short", "0%", "100%");
  host.remove();
  ui.closeStylePanel(false);
  return { error: null, result };
};
