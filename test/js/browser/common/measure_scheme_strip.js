// Reports the trigger's colour strip and the open list's item strips, plus the
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
  return {
    ok: true,
    triggerBar: rect(triggerBar),
    itemBars,
    lane: Math.round(lane),
    scrollable: dropdown.scrollHeight > dropdown.clientHeight,
  };
};
