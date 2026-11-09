// Reports the open scheme list's rows so the caller can press one with the
// mouse. Works for both consumers: the list is the same portalled surface.
() => {
  const dropdown = document.querySelector(".foliplus-scheme-picker-portal");
  if (!dropdown) return { ok: false, reason: "dropdown-not-open" };
  const items = Array.from(dropdown.querySelectorAll(".foliplus-scheme-picker-item"));
  const active = items.find(el => el.classList.contains("foliplus-is-active"));
  const target = items.find(el => el !== active) || items[0];
  if (!target) return { ok: false, reason: "no-items" };
  const rect = target.getBoundingClientRect();
  return {
    ok: true,
    itemCount: items.length,
    targetName: target.getAttribute("data-scheme-name"),
    targetX: rect.left + rect.width / 2,
    targetY: rect.top + rect.height / 2,
  };
};
