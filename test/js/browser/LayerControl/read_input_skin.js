// Read the computed input skin for the two input kinds this task unified:
// the LayerControl style-panel method select (a bridged native select) and
// label-size number, plus the HeatmapControl layer select. All three must
// resolve the same height, frame, radius, ink, type size and box model from
// .foliplus-input-skin so a regression in the shared class (or a missing
// call-site class) shows up here as a mismatch. The probe reads real computed
// styles because jsdom never loads the stylesheet cascade — only a browser can
// prove the parity.
//
// Every control takes its input through the shared skin class; a missing
// foliplus-input-skin on any one of them reads UA defaults (e.g. height: auto)
// and fails the parity assertion below.
//
// The label body collapses under the toggle until the user turns labels on, so
// the probe clicks the Label row's checkbox first (the delegated change handler
// reveals the body synchronously). The method select only exists in the
// by-value fill mode; the probe does not switch modes — the caller opens the
// ramp layer so value is the default.
() => {
  const read = el => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      height: s.height,
      borderTopWidth: s.borderTopWidth,
      borderRadius: s.borderRadius,
      backgroundColor: s.backgroundColor,
      fontSize: s.fontSize,
      color: s.color,
      boxSizing: s.boxSizing,
    };
  };
  const panel = document.querySelector(".foliplus-layer-style-panel");
  // Reveal the label body if the layer offers the Label section and it is off.
  if (panel) {
    const labelRow = Array.from(panel.querySelectorAll(".foliplus-form-row")).find(
      row =>
        /\u6807\u6ce8|Label/.test(
          ((row.querySelector(".foliplus-form-label") || {}).textContent || "").trim(),
        ),
    );
    const labelToggle = labelRow && labelRow.querySelector('input[type="checkbox"]');
    if (labelToggle && !labelToggle.checked) labelToggle.click();
  }
  // LayerControl method select: the fill method dropdown (a bridged native
  // select; the visible trigger is a sibling button, but the native select
  // carries the same skin class).
  const lcMethod = panel?.querySelector(".foliplus-style-fill-method-select");
  // LayerControl label-size number input.
  const lcNumber = panel?.querySelector(".foliplus-style-label-size-input");
  // HeatmapControl layer select.
  const heat = document.querySelector(".foliplus-heatmap-ctrl");
  const hmLayer = heat?.querySelector("select[data-heatmap-layer]");
  // The design tokens the skin resolves to, read from the same live
  // stylesheet so the test compares probe value to token value (never a
  // hardcoded px/rgb). A missing token makes this null and the assertion
  // fails loudly rather than passing on an unstyled element.
  const host = panel || heat || document.body;
  const cs = getComputedStyle(host);
  const px = name => {
    const v = cs.getPropertyValue(name).trim();
    if (!v) return null;
    const probeEl = document.createElement("div");
    probeEl.style.height = `var(${name})`;
    document.body.appendChild(probeEl);
    const resolved = getComputedStyle(probeEl).height;
    probeEl.remove();
    return resolved;
  };
  const bg = document.createElement("div");
  bg.style.background = "var(--foliplus-input-bg)";
  document.body.appendChild(bg);
  const inputBg = getComputedStyle(bg).backgroundColor;
  bg.remove();
  const ink = document.createElement("div");
  ink.style.color = "var(--foliplus-text-primary)";
  document.body.appendChild(ink);
  const textPrimary = getComputedStyle(ink).color;
  ink.remove();
  return {
    tokens: {
      ctrlSize: px("--foliplus-ctrl-size"),
      borderThin: px("--foliplus-border-thin"),
      radiusSm: px("--foliplus-radius-sm"),
      fontSizeMd: px("--foliplus-font-size-md"),
      inputBg,
      textPrimary,
    },
    lc: {
      ok: !!(lcMethod && lcNumber),
      method: read(lcMethod),
      number: read(lcNumber),
    },
    heat: { ok: !!hmLayer, layer: read(hmLayer) },
  };
};
