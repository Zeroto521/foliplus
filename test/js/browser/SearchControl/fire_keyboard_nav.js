(() => {
  // Exercise ArrowDown / ArrowUp / Enter without throwing.
  const inp = document.querySelector("input");
  try {
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    return true;
  } catch (e) {
    return false;
  }
})();
