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
  // dropdown is as wide as the trigger and the item's negative right margin
  // rides the gutter it actually has. A stale dropdown width or an unmeasured
  // gutter shows up here.
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
