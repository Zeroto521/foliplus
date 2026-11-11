// Measure the pixel width of the given strings in the panel's label font
// (the .foliplus-form-label computed font), so a test can guard that the
// longest form-row label still fits the shared label column token.
({ root, strings } = {}) => {
  const rootEl = document.querySelector(root || ".foliplus-layer-style-panel");
  if (!rootEl) return { ok: false, reason: "no-panel" };
  const label = rootEl.querySelector(".foliplus-form-label");
  if (!label) return { ok: false, reason: "no-label" };
  const cs = getComputedStyle(label);
  const font =
    cs.fontStyle +
    " " +
    cs.fontVariant +
    " " +
    cs.fontWeight +
    " " +
    cs.fontSize +
    " " +
    cs.fontFamily;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  const widths = strings.map(s => ({ s, w: ctx.measureText(s).width }));
  const max = Math.max(...widths.map(x => x.w), 0);
  const style = getComputedStyle(rootEl);
  const token = parseFloat(style.getPropertyValue("--foliplus-form-label-width"));
  const pad = parseFloat(style.getPropertyValue("--foliplus-space-xs"));
  return { ok: true, font, widths, max, token, paddingRight: pad };
};
