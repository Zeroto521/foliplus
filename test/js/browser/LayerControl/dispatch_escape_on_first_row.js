// Focus the first row and dispatch Escape — resets the cursor-only glow
// without actually unfocusing the DOM node.
() => {
  const r = document.querySelector(".foliplus-layer-item");
  r.focus();
  r.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};
