// Sample the fill/border paint-dimension rows of one layer's style panel.
// Shared sampler for the parity harness: the JS probe (hand use) and the Python
// browser test (CI) both call this same function. Returns a JSON snapshot keyed
// by {dim}.{mode} of the requested layer.
//
// Sampled per the paint-dimension parity harness:
//   - DOM structure: row root tagName + className (class stack ORDER), children
//     2 levels (tag + class stack + role + data-action), detail slot children
//   - class stack order (S6 abstraction can drift it)
//   - aria: mode select aria-label, interactive role/aria-label/pressed/checked,
//     row aria-hidden
//   - computed style: display/position/flex-direction/gap/width/height/color/
//     background-color/border-color/visibility/opacity
// NOT sampled: id/data-* dynamic values, text content, transition/transform/font.
//
// Arg: { layerName, dims?:["fill","border"], modes?: {fill:[...],border:[...]} }
// Modes are filtered to what the panel actually offers (option values present).
arg => {
  const a = arg || window.__PARITY_ARG__ || {};
  const layerName = a.layerName || "Polygons";
  const dims = a.dims || ["fill", "border"];
  const requested = a.modes || {
    fill: ["original", "solid", "value"],
    border: ["original", "solid", "value", "followFill"],
  };

  const findLayerRow = name => {
    return [
      ...document.querySelectorAll(".foliplus-layer-item[data-layer-type=overlay]"),
    ].find(r => r.textContent.includes(name));
  };
  const openStylePanel = name => {
    const row = findLayerRow(name);
    if (!row) return { ok: false, reason: "no-layer-row:" + name };
    // Close any other open style panel first (a different layer may have it).
    document.querySelectorAll(".foliplus-layer-style-panel").forEach(p => p.remove());
    const btn = row.querySelector(".foliplus-layer-more-btn");
    btn.click();
    const menu = row.querySelector(".foliplus-layer-more-menu.open");
    if (!menu) return { ok: false, reason: "menu-not-open" };
    const item = menu.querySelector('button[data-action="style-layer"]');
    if (!item) return { ok: false, reason: "no-style-item" };
    item.click();
    const panel = row.querySelector(".foliplus-layer-style-panel");
    return { ok: !!panel, panel };
  };

  const classNameStack = el =>
    el ? (el.className || "").split(/\s+/).filter(Boolean) : [];
  const tagName = el => (el ? el.tagName : null);
  const childTree = (el, depth) => {
    if (!el || depth > 2) return [];
    return [...el.children].map(c => ({
      tag: c.tagName,
      cls: classNameStack(c),
      role: c.getAttribute("role"),
      action: c.getAttribute("data-action"),
      children: childTree(c, depth + 1),
    }));
  };
  const ariaOf = el => {
    if (!el) return {};
    const out = {};
    for (const a of [
      "aria-label",
      "aria-pressed",
      "aria-checked",
      "aria-hidden",
      "role",
      "aria-expanded",
      "aria-disabled",
    ]) {
      const v = el.getAttribute(a);
      if (v !== null) out[a] = v;
    }
    return out;
  };
  const computed = el => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      display: s.display,
      position: s.position,
      flexDirection: s.flexDirection,
      gap: s.gap,
      width: s.width,
      height: s.height,
      color: s.color,
      backgroundColor: s.backgroundColor,
      borderColor: s.borderColor,
      visibility: s.visibility,
      opacity: s.opacity,
    };
  };
  let panelRoot = null;
  const blockSel = dim =>
    dim === "fill" ? ".foliplus-style-fill-block" : ".foliplus-style-border-block";
  const selectSel = dim =>
    dim === "fill"
      ? ".foliplus-style-fill-mode-select"
      : ".foliplus-style-border-mode-select";

  const sampleOne = (dim, mode) => {
    const root = panelRoot || document;
    const block = root.querySelector(blockSel(dim));
    if (!block) return { present: false, reason: "no-" + dim + "-block" };
    const select = block.querySelector(selectSel(dim));
    if (!select) return { present: false, reason: "no-mode-select" };
    if (![...select.options].some(o => o.value === mode)) {
      return {
        present: false,
        reason: "mode-not-offered",
        offered: [...select.options].map(o => o.value),
      };
    }
    select.value = mode;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const detail = block.querySelector(
      dim === "fill" ? ".foliplus-style-fill-detail" : ".foliplus-style-border-detail",
    );
    const rowRoot = block.querySelector(".foliplus-form-row") || block;
    return {
      present: true,
      mode,
      dim,
      offered: [...select.options].map(o => o.value),
      row: {
        tag: tagName(rowRoot),
        cls: classNameStack(rowRoot),
        children: childTree(rowRoot, 0),
        aria: ariaOf(rowRoot),
      },
      detail: detail
        ? {
            tag: tagName(detail),
            cls: classNameStack(detail),
            children: childTree(detail, 0),
            aria: ariaOf(detail),
            computed: computed(detail),
          }
        : null,
      select: select
        ? {
            tag: tagName(select),
            cls: classNameStack(select),
            aria: ariaOf(select),
            computed: computed(select),
          }
        : null,
      keyComputed: {
        color: computed(
          block.querySelector(
            ".foliplus-style-fill-color-input, .foliplus-style-border-color-input",
          ),
        ),
        number: computed(
          block.querySelector(
            ".foliplus-style-fill-opacity-number, .foliplus-style-border-weight-input",
          ),
        ),
      },
    };
  };

  const opened = openStylePanel(layerName);
  if (!opened.ok) return opened;
  const panel = opened.panel;
  panelRoot = panel;
  const snapshot = {};
  for (const dim of dims) {
    snapshot[dim] = {};
    for (const mode of requested[dim] || []) {
      snapshot[dim][mode] = sampleOne(dim, mode);
    }
  }
  return { ok: true, layerName, snapshot };
};
