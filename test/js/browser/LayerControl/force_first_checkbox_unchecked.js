() => {
  const box = document.querySelector(".foliplus-layer-item input[type=checkbox]");
  if (box && box.checked) {
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }
};
