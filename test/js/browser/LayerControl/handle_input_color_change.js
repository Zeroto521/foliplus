() => {
  const input = document.querySelector(".foliplus-color-layer-input");
  if (!input) return null;
  const prev = document
    .querySelector(".foliplus-color-layer-item")
    ?.classList.contains("active");
  input.value = "#ff0000";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return { inputExists: true, wasActive: !!prev };
};
