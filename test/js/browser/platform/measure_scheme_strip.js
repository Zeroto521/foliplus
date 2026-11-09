// Reports the trigger's color strip and the open list's item strips, plus the
// layout lane the list's scrollbar takes and whether the list scrolls.
triggerSelector => {
  const trigger = document.querySelector(triggerSelector);
  if (!trigger) return { ok: false, reason: "no-trigger" };
  const dropdown = document.querySelector(".foliplus-scheme-picker-portal");
  if (!dropdown) return { ok: false, reason: "no-dropdown" };
  const rect = el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  };
  const triggerBar = trigger.querySelector(".foliplus-scheme-picker-bar");
  if (!triggerBar) return { ok: false, reason: "no-trigger-strip" };
  const itemBars = [...dropdown.querySelectorAll(".foliplus-scheme-picker-item")]
    .map(item => item.querySelector(".foliplus-scheme-picker-bar"))
    .filter(Boolean)
    .map(rect);
  const style = getComputedStyle(dropdown);
  const lane =
    dropdown.offsetWidth -
    dropdown.clientWidth -
    parseFloat(style.borderLeftWidth) -
    parseFloat(style.borderRightWidth);
  // Diagnostics for an alignment failure: the strips can only match when the
  // dropdown is as wide as the trigger and its item inset subtracts the lane it
  // actually has. A stale dropdown width or an unmeasured lane shows up here.
  const content = trigger.closest(".foliplus-panel-content");
  return {
    ok: true,
    triggerBar: rect(triggerBar),
    itemBars,
    lane: Math.round(lane),
    scrollable: dropdown.scrollHeight > dropdown.clientHeight,
    laneVar: style.getPropertyValue("--foliplus-scheme-picker-scrollbar-width").trim(),
    trigger: rect(trigger),
    dropdown: rect(dropdown),
    dropdownInlineWidth: dropdown.style.width,
    itemPaddingRight: getComputedStyle(
      dropdown.querySelector(".foliplus-scheme-picker-item"),
    ).paddingRight,
    // The resolved strip inset: the item's left padding (the shared
    // --foliplus-scheme-picker-bar-inset-x token), read from the DOM rather
    // than hardcoded, so the invariant tracks a consumer override too.
    itemInset: parseFloat(
      getComputedStyle(dropdown.querySelector(".foliplus-scheme-picker-item"))
        .paddingLeft,
    ),
    // The dropdown's padding-box right edge: border-box right minus the right
    // border. This is where the trigger's strip would sit minus the inset.
    paddingBoxRight:
      dropdown.getBoundingClientRect().right - parseFloat(style.borderRightWidth),
    // The scrollport right edge = padding-box left + clientWidth. clientWidth
    // is the padding box minus any scrollbar gutter, so this is the right edge
    // of the visible content area (the clip line). A classic scrollbar's
    // gutter lies beyond it and cannot be painted by the row.
    scrollportRight:
      dropdown.getBoundingClientRect().left +
      parseFloat(style.borderLeftWidth) +
      dropdown.clientWidth,
    content: content
      ? {
          clientWidth: content.clientWidth,
          offsetWidth: content.offsetWidth,
          clientHeight: content.clientHeight,
          scrollHeight: content.scrollHeight,
        }
      : null,
  };
};
