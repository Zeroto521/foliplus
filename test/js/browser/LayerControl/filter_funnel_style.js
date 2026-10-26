// Computed style of the filtered-row funnel: it must be neutral
// (--foliplus-text-primary) and the SVG must explicitly fill with currentColor
// — the icon ships its own fill, so CSS `color` alone never reaches it.
// Registers a capability layer whose committed filter paints the funnel, reads
// the computed values, then unregisters the probe row.
() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const ID = "__filter_funnel_probe__";
  api.registerLayer({
    id: ID,
    name: "Filter Funnel Probe",
    layer: L.layerGroup(),
    filterProvider: () => ({
      field: "value",
      range: [0, 10],
      filter: { kind: "atom", field: "value", op: "between", range: [2, 8] },
      kept: 4,
      total: 10,
      step: 1,
    }),
    filterSetter: () => {},
  });
  const q = sel => document.querySelector(sel);
  const row = q(`.foliplus-layer-item[data-layer-id="${ID}"]`);
  const funnel = row ? row.querySelector(".foliplus-layer-count-funnel") : null;
  const svg = funnel ? funnel.querySelector("svg") : null;
  if (!funnel || !svg) return { ok: false, reason: "no-funnel" };
  const token = name => {
    const p = document.createElement("div");
    p.style.background = `var(${name})`;
    document.body.appendChild(p);
    const c = getComputedStyle(p).backgroundColor;
    p.remove();
    return c;
  };
  const box = funnel.getBoundingClientRect();
  const style = getComputedStyle(funnel);
  const svgStyle = getComputedStyle(svg);
  const out = {
    ok: true,
    color: style.color,
    fill: svgStyle.fill,
    svgWidth: svg.getBoundingClientRect().width,
    svgHeight: svg.getBoundingClientRect().height,
    funnelWidth: box.width,
    funnelHeight: box.height,
    countText: (row.querySelector(".foliplus-layer-count-value") || {}).textContent,
    rowTitle: row.getAttribute("title"),
    textPrimary: token("--foliplus-text-primary"),
    accent: token("--foliplus-accent-primary"),
  };
  api.unregisterLayer(ID);
  return out;
};
