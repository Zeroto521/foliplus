// Style-panel placement and inner scroll: the pinned card always opens
// downward from its row, and a long panel scrolls inside its own content box
// instead of flipping up or growing over the viewport.
//
// `ramp` switches the fill detail to the by-value arm and the label section is
// expanded when the layer offers it, so the card is genuinely long: the shared
// 400px cap then has to make the content itself scrollable.
({ ramp } = {}) => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { ok: false, reason: "no-panel" };
  if (ramp) {
    const mode = panel.querySelector(".foliplus-style-fill-mode-select");
    if (mode && mode.value !== "ramp") {
      mode.value = "ramp";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  // The label block is the panel's long tail: its sub-rows are collapsed until
  // the label toggle is on.
  const labelRow = Array.from(panel.querySelectorAll(".foliplus-form-row")).find(row =>
    /标注|Label/.test(
      ((row.querySelector(".foliplus-form-label") || {}).textContent || "").trim(),
    ),
  );
  const labelToggle = labelRow && labelRow.querySelector('input[type="checkbox"]');
  if (labelToggle && !labelToggle.checked) labelToggle.click();

  const row = panel.closest(".foliplus-layer-item");
  const content = panel.querySelector(".foliplus-panel-content");
  // The layer list lives in the fold panel's scrolling content: that is what a
  // chained wheel would move.
  const list = document.querySelector(".foliplus-layer-ctrl .foliplus-panel-content");
  if (!row || !content) return { ok: false, reason: "no-row-or-content" };
  const pr = panel.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  const cs = getComputedStyle(content);
  return {
    ok: true,
    panel: {
      top: pr.top,
      left: pr.left,
      width: pr.width,
      height: pr.height,
      bottom: pr.bottom,
    },
    row: { top: rr.top, bottom: rr.bottom },
    content: {
      overflowY: cs.overflowY,
      panelMaxHeight: getComputedStyle(panel).maxHeight,
      scrollTop: content.scrollTop,
      scrollHeight: content.scrollHeight,
      clientHeight: content.clientHeight,
      scrollbarWidth: content.offsetWidth - content.clientWidth,
      rect: content.getBoundingClientRect().toJSON(),
    },
    listScrollTop: list ? list.scrollTop : null,
    opensDownward: pr.top >= rr.bottom,
    pinned: panel.classList.contains("foliplus-is-pinned"),
    position: getComputedStyle(panel).position,
  };
};
