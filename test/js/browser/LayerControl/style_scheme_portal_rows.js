// Reports the open scheme list: where its rows are and what the picker and the
// drawer currently show. The caller presses a row with the mouse.
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const dropdown = document.querySelector(".foliplus-scheme-picker-portal");
  if (!panel) return { ok: false, reason: "no-panel" };
  if (!dropdown) return { ok: false, reason: "dropdown-not-open" };

  const items = Array.from(dropdown.querySelectorAll(".foliplus-scheme-picker-item"));
  const active = items.find(el => el.classList.contains("foliplus-is-active"));
  const target = items.find(el => el !== active) || items[0];
  if (!target) return { ok: false, reason: "no-items" };

  const itemRect = target.getBoundingClientRect();
  const dropdownRect = dropdown.getBoundingClientRect();
  const trigger = panel.querySelector(".foliplus-style-scheme-trigger");
  const hidden = panel.querySelector(".foliplus-scheme-picker-hidden");
  return {
    ok: true,
    itemCount: items.length,
    targetName: target.getAttribute("data-scheme-name"),
    targetX: itemRect.left + itemRect.width / 2,
    targetY: itemRect.top + itemRect.height / 2,
    dropdownParentTag: dropdown.parentElement ? dropdown.parentElement.tagName : null,
    dropdownInViewport:
      dropdownRect.top >= 0 &&
      dropdownRect.left >= 0 &&
      dropdownRect.bottom <= innerHeight &&
      dropdownRect.right <= innerWidth,
    dropdownRect: dropdownRect.toJSON(),
    hiddenValue: hidden ? hidden.value : null,
    triggerTitle: trigger ? trigger.title : null,
  };
};
