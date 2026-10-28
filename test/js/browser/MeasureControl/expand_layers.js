() => {
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (!ctrl.classList.contains("foliplus-is-expanded")) {
    ctrl.querySelector(".foliplus-toggle-btn").click();
  }
  return true;
};
