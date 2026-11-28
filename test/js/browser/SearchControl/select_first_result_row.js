// Moves the keyboard cursor onto the first result row (ArrowDown from none).
() => {
  const input = document.querySelector(".foliplus-search input");
  if (!input) return { ok: false, reason: "no-input" };
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  const row = document.querySelector(".foliplus-search-result-item.foliplus-is-active");
  return { ok: true, active: !!row };
};
