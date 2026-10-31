// Read a panel's form rows: visible label text, label geometry and the
// accessible name of every control in the row.
//
// `labelLines` counts text line boxes with Range.getClientRects(): the label's
// own rect always reports one row height, so a wrapped label would otherwise
// look single-line. The `ramp` flag switches the style panel's fill detail to
// the ramp arm first — that is where the method + class-count row exists.
({ root, ramp } = {}) => {
  const rootEl = document.querySelector(root || ".foliplus-layer-style-panel");
  if (!rootEl) return { ok: false, reason: "no-panel" };
  if (ramp) {
    const mode = rootEl.querySelector(".foliplus-style-fill-mode-select");
    if (!mode) return { ok: false, reason: "no-mode-select" };
    if (mode.value !== "ramp") {
      mode.value = "ramp";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  const style = getComputedStyle(rootEl);
  const rows = Array.from(rootEl.querySelectorAll(".foliplus-form-row"))
    .map(row => {
      const label = row.querySelector(".foliplus-form-label");
      if (!label) return null;
      const range = document.createRange();
      range.selectNodeContents(label);
      return {
        text: (label.textContent || "").trim(),
        labelWidth: label.getBoundingClientRect().width,
        labelLines: range.getClientRects().length,
        whiteSpace: getComputedStyle(label).whiteSpace,
        panelWidth: rootEl.getBoundingClientRect().width,
        // Only the controls a user can reach count: the shared dropdown keeps a
        // hidden native select in the row as its value/change bridge, and that
        // element is out of the accessibility tree. Its accessible name lives on
        // the visible trigger, so counting the bridge would report the same
        // control twice and the second time as an empty name.
        ariaLabels: Array.from(
          row.querySelectorAll("select, input, button, [role=combobox]"),
        )
          .filter(
            el =>
              el.closest("[hidden]") === null &&
              el.getAttribute("aria-hidden") !== "true",
          )
          .map(el => el.getAttribute("aria-label")),
      };
    })
    .filter(Boolean);
  return {
    ok: true,
    rows,
    labelWidthToken: style.getPropertyValue("--foliplus-form-label-width").trim(),
    panelWidthToken: style.getPropertyValue("--foliplus-panel-width").trim(),
  };
};
