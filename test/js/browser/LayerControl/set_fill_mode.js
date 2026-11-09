// Set the style drawer's fill mode (the "by value" / "single color" /
// "original colors" mode) by value, like a user choosing from the select.
arg => {
  const { mode } = arg ?? {};
  const select = document.querySelector(".foliplus-style-fill-mode-select");
  if (!select) return { ok: false, reason: "no-mode-select" };
  if (!["original", "solid", "value"].includes(mode)) {
    return { ok: false, reason: "bad-mode", mode };
  }
  select.value = mode;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, mode: select.value };
};
