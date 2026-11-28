() => {
  // Measure one dropdown option row's paint box against the popup's content box.
  // The row element is the paint target (background / selected wash + the inset
  // emphasis bar), so the highlight fills the popup only when the row's border
  // box coincides with the list's content box: a reserved scrollbar-gutter lane
  // leaves the row short of the right border and the wash stops early.
  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return (
      r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden"
    );
  };
  const list = Array.from(document.querySelectorAll(".foliplus-dropdown-list")).find(
    visible,
  );
  if (!list) return { ok: false, reason: "no-list" };
  const row = list.querySelector('.foliplus-dropdown-option[aria-selected="true"]');
  if (!row) return { ok: false, reason: "no-selected-row" };
  const listRect = list.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const listStyle = getComputedStyle(list);
  const rowStyle = getComputedStyle(row);
  const px = value => parseFloat(value) || 0;
  const borderLeft = px(listStyle.borderLeftWidth);
  const borderRight = px(listStyle.borderRightWidth);
  const paddingLeft = px(listStyle.paddingLeft);
  const paddingRight = px(listStyle.paddingRight);
  const contentLeft = listRect.left + borderLeft + paddingLeft;
  const contentRight = listRect.right - borderRight - paddingRight;
  const centreY = (rowRect.top + rowRect.bottom) / 2;
  const covers = hits => hits.includes(row) || hits.some(el => row.contains(el));
  const hitAtRight = document.elementsFromPoint(contentRight - 2, centreY);
  const hitAtLeft = document.elementsFromPoint(contentLeft + 2, centreY);
  // Chromium serialises "inset <bar> 0 0 <color>" with the color first and the
  // lengths after it, e.g. "rgb(…), 3px 0px 0px 0px inset" -> strip the color.
  const shadow = rowStyle.boxShadow;
  const lengthTokens = shadow
    .replace(/rgba?\([^)]*\)/g, "")
    .trim()
    .split(/\s+/)
    .filter(token => token.endsWith("px"));
  const hasInsetBar = shadow.includes("inset");
  return {
    ok: true,
    list: {
      left: listRect.left,
      right: listRect.right,
      width: listRect.width,
      offsetWidth: list.offsetWidth,
      clientWidth: list.clientWidth,
      borderLeftWidth: borderLeft,
      borderRightWidth: borderRight,
      paddingLeft,
      paddingRight,
      scrollbarGutter: listStyle.scrollbarGutter,
      scrollbarWidth: listStyle.scrollbarWidth,
    },
    row: {
      left: rowRect.left,
      right: rowRect.right,
      width: rowRect.width,
      background: rowStyle.backgroundColor,
      boxShadow: shadow,
      barWidth: hasInsetBar ? px(lengthTokens[0]) : 0,
      text: row.textContent,
      ariaSelected: row.getAttribute("aria-selected"),
    },
    contentLeft,
    contentRight,
    // Positive => the highlight stops short of the content box edge.
    gapLeft: rowRect.left - contentLeft,
    gapRight: contentRight - rowRect.right,
    scrollbarLane: list.offsetWidth - list.clientWidth - borderLeft - borderRight,
    rowIsPaintAtLeft: covers(hitAtLeft),
    rowIsPaintAtRight: covers(hitAtRight),
  };
};
