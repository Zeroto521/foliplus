// The style panel's scheme dropdown must clear the panel that opened it.
//
// The panel is a row panel: position: fixed and pinned under its row, while the
// scheme dropdown is portaled to <body>. Both float, so the dropdown's z band
// has to beat the expanded control's (+1 bar / +9 section) or the panel paints
// over the open list — the exact bug this test pins.
//
// Opens the ramp detail, clicks the scheme trigger, then reports geometry and
// hit tests. Everything is measured from live rects, no magic numbers.
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { ok: false, reason: "no-panel" };
  const mode = panel.querySelector(".foliplus-style-fill-mode-select");
  if (!mode) return { ok: false, reason: "no-mode-select" };
  mode.value = "ramp";
  mode.dispatchEvent(new Event("change", { bubbles: true }));

  const trigger = panel.querySelector(".foliplus-style-scheme-trigger");
  if (!trigger) return { ok: false, reason: "no-scheme-trigger", value: mode.value };
  trigger.click();

  const dropdown = document.querySelector(".foliplus-scheme-picker-dropdown");
  const rect = el => el && el.getBoundingClientRect();
  const hit = el => {
    const r = rect(el);
    if (!r) return null;
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return at
      ? at.className && typeof at.className === "string"
        ? at.className
        : at.tagName
      : null;
  };
  const inViewport = r =>
    !!r &&
    r.top >= 0 &&
    r.left >= 0 &&
    r.bottom <= innerHeight &&
    r.right <= innerWidth;
  const panelRect = rect(panel);
  const triggerRect = rect(trigger);
  const dropdownRect = rect(dropdown);
  const triggerHit = triggerRect
    ? document.elementFromPoint(
        triggerRect.left + triggerRect.width / 2,
        triggerRect.top + triggerRect.height / 2,
      )
    : null;
  const dropdownHit = dropdownRect
    ? document.elementFromPoint(
        dropdownRect.left + dropdownRect.width / 2,
        dropdownRect.top + dropdownRect.height / 2,
      )
    : null;
  return {
    ok: true,
    panelRect: panelRect,
    panelInViewport: inViewport(panelRect),
    panelPosition: getComputedStyle(panel).position,
    triggerInViewport: inViewport(triggerRect),
    triggerHitInsidePanel:
      !!triggerHit && !!triggerHit.closest(".foliplus-layer-style-panel"),
    dropdownRect: dropdownRect,
    dropdownInViewport: inViewport(dropdownRect),
    dropdownHitInsideDropdown:
      !!dropdownHit && !!dropdownHit.closest(".foliplus-scheme-picker-dropdown"),
    dropdownParent: dropdown ? dropdown.parentElement.tagName : null,
    dropdownZ: dropdown ? getComputedStyle(dropdown).zIndex : null,
    dropdownClass: dropdown ? dropdown.className : null,
    dropdownHitClass: hit(dropdown),
  };
};
