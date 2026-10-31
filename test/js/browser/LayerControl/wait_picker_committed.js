// Waits for the scheme picker's open state to be committed before a test presses
// Escape: the portal is attached a beat before the trigger's aria-expanded and
// the row layout settle, and pressing Escape in that window reads the picker as
// not open, so the registry's topmost() falls through to the style drawer and
// one press tears down both. Only the committed state guarantees the picker
// owns Escape. Passed to page.wait_for_function.
() => {
  const portal = document.querySelector(".foliplus-scheme-picker-portal");
  const trigger = document.querySelector(".foliplus-style-scheme-trigger");
  if (!portal || !trigger) return false;
  if (portal.getBoundingClientRect().height <= 0) return false;
  if (trigger.getAttribute("aria-expanded") !== "true") return false;
  return portal.querySelectorAll(".foliplus-scheme-picker-item").length > 0;
};
