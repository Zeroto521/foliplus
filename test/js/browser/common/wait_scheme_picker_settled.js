// Waits for the open scheme picker's dropdown width to match the trigger width.
//
// The picker's dropdown is positioned with the trigger width at open, but the
// trigger can resize one frame later (e.g. a layout scrollbar lane disappears
// from the panel content when the picker portals out, widening the trigger).
// The dropdown follows via a ResizeObserver, but that settles on the next
// animation frame. Measuring immediately after the portal is attached can
// therefore read a stale width on a slow frame.
//
// This is an assertion-style wait: it polls every animation frame up to a 5s
// budget and resolves `true` once the widths agree. If the budget runs out it
// resolves a diagnostics object (never silently true), so a genuine "never
// settles" product bug turns into a red test carrying the width/lane evidence,
// rather than a silently slow pass.
//
// Returns: `true` when settled, or a diagnostics object when the budget is
// exhausted.
triggerSelector => {
  const dropdown = document.querySelector(".foliplus-scheme-picker-portal");
  if (!dropdown) return { ok: false, reason: "no-dropdown", triggerSelector };
  const trigger = document.querySelector(triggerSelector);
  if (!trigger) return { ok: false, reason: "no-trigger", triggerSelector };
  const style = getComputedStyle(dropdown);
  const lane =
    dropdown.offsetWidth -
    dropdown.clientWidth -
    parseFloat(style.borderLeftWidth) -
    parseFloat(style.borderRightWidth);
  const content = trigger.closest(".foliplus-panel-content");
  const diag = () => ({
    ok: false,
    reason: "width-not-settled",
    triggerSelector,
    dropdownWidth: dropdown.getBoundingClientRect().width,
    dropdownInlineWidth: dropdown.style.width,
    triggerWidth: trigger.getBoundingClientRect().width,
    lane: Math.round(lane),
    content: content
      ? {
          clientWidth: content.clientWidth,
          offsetWidth: content.offsetWidth,
        }
      : null,
  });
  const deadline = performance.now() + 5000;
  return new Promise(resolve => {
    const tick = () => {
      const settled =
        Math.abs(
          dropdown.getBoundingClientRect().width -
            trigger.getBoundingClientRect().width,
        ) <= 0.5;
      if (settled) return resolve(true);
      if (performance.now() > deadline) return resolve(diag());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
};
