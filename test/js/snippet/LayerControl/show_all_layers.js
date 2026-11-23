() => {
  const boxes = document.querySelectorAll(".foliplus-layer-item input[type=checkbox]");
  boxes.forEach(cb => {
    if (!cb.checked) cb.click();
  });
};
