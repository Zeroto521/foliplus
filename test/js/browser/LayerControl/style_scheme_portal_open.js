// Opens the style drawer's fill ramp and, unless suppressed, the scheme
// picker's list; reports the viewport points of the trigger and of a colour row
// the caller should really click.
//
// The regression this supports lives in the document mousedown capture phase,
// which `element.click()` never triggers: the test has to press with the
// mouse, so the probe returns coordinates instead of clicking itself.
(wantOpen = true) => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { ok: false, reason: "no-panel" };
  const mode = panel.querySelector(".foliplus-style-fill-mode-select");
  if (!mode) return { ok: false, reason: "no-mode-select" };
  if (mode.value !== "ramp") {
    mode.value = "ramp";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const trigger = panel.querySelector(".foliplus-style-scheme-trigger");
  if (!trigger) return { ok: false, reason: "no-scheme-trigger" };
  const triggerRect = trigger.getBoundingClientRect();
  let dropdown = document.querySelector(".foliplus-scheme-picker-portal");
  if (wantOpen && !dropdown) {
    trigger.click();
    dropdown = document.querySelector(".foliplus-scheme-picker-portal");
    if (!dropdown) return { ok: false, reason: "dropdown-not-open" };
  }

  const panelRect = panel.getBoundingClientRect();
  const base = {
    ok: true,
    triggerX: triggerRect.left + triggerRect.width / 2,
    triggerY: triggerRect.top + triggerRect.height / 2,
    dropdownPresent: !!dropdown,
    dropdownParentTag:
      dropdown && dropdown.parentElement ? dropdown.parentElement.tagName : null,
    panelRect: {
      left: panelRect.left,
      top: panelRect.top,
      right: panelRect.right,
      bottom: panelRect.bottom,
    },
    viewport: { width: innerWidth, height: innerHeight },
  };
  if (!dropdown) return base;

  const items = Array.from(dropdown.querySelectorAll(".foliplus-scheme-picker-item"));
  const active = items.find(el => el.classList.contains("foliplus-is-active"));
  const target = items.find(el => el !== active) || items[0];
  if (!target) return { ...base, ok: false, reason: "no-items" };

  const itemRect = target.getBoundingClientRect();
  const hidden = panel.querySelector(".foliplus-scheme-picker-hidden");
  return {
    ...base,
    itemCount: items.length,
    targetName: target.getAttribute("data-scheme-name"),
    targetX: itemRect.left + itemRect.width / 2,
    targetY: itemRect.top + itemRect.height / 2,
    dropdownClass: dropdown.className,
    hiddenValue: hidden ? hidden.value : null,
    triggerTitle: trigger.title,
  };
};
