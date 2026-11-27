// Measures a search result row's paint box against the panel's content box.
(arg = {}) => {
  const { rowIndex = 0 } = arg ?? {};
  const panel = document.querySelector(".foliplus-search-result-panel");
  if (!panel) return { ok: false, reason: "no-panel" };
  const rows = panel.querySelectorAll(".foliplus-search-result-item");
  const row = rows[rowIndex];
  if (!row) return { ok: false, reason: "no-row" };
  const text = row.querySelector(".foliplus-search-result-text");
  // The flex column that owns the text line box: its width is the "text line
  // width" a gutter crossing must not change (the span itself is content-sized).
  const content = row.querySelector(".foliplus-search-result-content");
  const ps = getComputedStyle(panel);
  const pr = panel.getBoundingClientRect();
  const borderL = parseFloat(ps.borderLeftWidth || "0");
  const borderR = parseFloat(ps.borderRightWidth || "0");
  const padL = parseFloat(ps.paddingLeft || "0");
  const padR = parseFloat(ps.paddingRight || "0");
  const contentLeft = pr.left + borderL + padL;
  const contentRight = pr.right - borderR - padR;
  const rr = row.getBoundingClientRect();
  const tr = text ? text.getBoundingClientRect() : null;
  const lane = parseFloat(ps.getPropertyValue("--foliplus-scrollbar-lane") || "0");
  // "Overflowing" means the content is capped, not that the border box is a few
  // px shorter than its scrollHeight (the panel's cap equals its natural height
  // while it fits, so scrollHeight always exceeds clientHeight by the borders).
  const maxH = parseFloat(ps.maxHeight || "NaN");
  const rowStyle = getComputedStyle(row);
  const y = rr.top + rr.height / 2;
  const hitRight = document.elementFromPoint(contentRight - 1, y);
  const hitLeft = document.elementFromPoint(contentLeft + 1, y);
  const inRow = el => !!el && (el === row || row.contains(el));
  return {
    ok: true,
    lane,
    overflow: Number.isFinite(maxH)
      ? panel.scrollHeight > maxH + 2
      : panel.scrollHeight > panel.clientHeight + 2,
    rowCount: rows.length,
    panel: {
      left: pr.left,
      right: pr.right,
      clientWidth: panel.clientWidth,
      offsetWidth: panel.offsetWidth,
      borderLeft: borderL,
      borderRight: borderR,
      paddingLeft: padL,
      paddingRight: padR,
    },
    contentLeft,
    contentRight,
    row: { left: rr.left, right: rr.right, width: rr.width },
    text: tr ? { left: tr.left, right: tr.right, width: tr.width } : null,
    content: content
      ? {
          left: content.getBoundingClientRect().left,
          width: content.getBoundingClientRect().width,
        }
      : null,
    gapLeft: rr.left - contentLeft,
    gapRight: contentRight - rr.right,
    active: row.classList.contains("foliplus-is-active"),
    background: rowStyle.backgroundColor,
    hitAtLeftEdge: inRow(hitLeft),
    hitAtRightEdge: inRow(hitRight),
  };
};
