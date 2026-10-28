// Pick a palette in the style drawer's scheme picker (#789 browser gate).
//
// The picker is a portalled listbox, so a scheme is chosen the way a user
// chooses it: open the trigger, then press the row that names the scheme. The
// row carries the scheme name in `data-scheme-name` (#793's shared picker).
arg => {
  const name = arg?.scheme;
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const trigger = panel?.querySelector(".foliplus-style-scheme-trigger");
  if (!trigger) return { ok: false, reason: "no-scheme-trigger" };
  trigger.click();
  const dropdown = document.querySelector(".foliplus-scheme-picker-portal");
  if (!dropdown) return { ok: false, reason: "picker-not-open" };
  const items = [...dropdown.querySelectorAll(".foliplus-scheme-picker-item")];
  const item = name
    ? items.find(el => el.getAttribute("data-scheme-name") === name)
    : null;
  if (!item) {
    return {
      ok: false,
      reason: "no-such-scheme",
      schemes: items.map(el => el.getAttribute("data-scheme-name")),
    };
  }
  item.click();
  return { ok: true };
};
