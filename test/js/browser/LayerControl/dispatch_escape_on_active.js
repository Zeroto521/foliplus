// Focus the currently-active row and dispatch a real Escape keydown — used
// to cancel the cursor-only glow (the cursor state, not focus).
() => {
  const r = document.querySelector(".foliplus-layer-item.foliplus-active");
  r.focus();
  r.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};
