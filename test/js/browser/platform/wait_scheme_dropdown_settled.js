// wait_for_function predicate: the scheme-picker portal has been positioned
// and its geometry is stable across a frame.
//
// The portal is attached and then positioned by a placement pass that may run
// on the next frame after the trigger is clicked. Reading getBoundingClientRect
// immediately after state="attached" can observe the pre-layout box (or a
// mid-reflow box), so the flip verdict ("ruleHolds") disagrees with the shared
// rule on timing alone. Wait until the dropdown's rect is identical on two
// consecutive frames before measuring.
() => {
  const dropdown = document.querySelector(".foliplus-scheme-picker-dropdown");
  const trigger = document.querySelector(
    '.foliplus-scheme-picker-trigger[aria-expanded="true"]',
  );
  if (!dropdown || !trigger) return false;
  // Reuse the module-scope cache: compare against the previous frame's rect.
  const r = dropdown.getBoundingClientRect();
  if (!window.__foliplusSchemePrev) {
    window.__foliplusSchemePrev = { left: r.left, top: r.top, w: r.width, h: r.height };
    return false;
  }
  const prev = window.__foliplusSchemePrev;
  const stable =
    Math.abs(prev.left - r.left) < 0.5 &&
    Math.abs(prev.top - r.top) < 0.5 &&
    Math.abs(prev.w - r.width) < 0.5 &&
    Math.abs(prev.h - r.height) < 0.5;
  window.__foliplusSchemePrev = { left: r.left, top: r.top, w: r.width, h: r.height };
  return stable;
};
