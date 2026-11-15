// Reads the heatmap panel after Clear: it must stay expanded, and focus must
// stay on its own Clear button while the restored declaration keeps it visible.
() => {
  const shell = document.querySelector(".foliplus-heatmap-ctrl");
  const clear = document.querySelector("[data-heatmap-btn-clear]");
  return {
    expanded: !!shell && shell.classList.contains("foliplus-is-expanded"),
    focusIsClear: !!clear && !!clear.offsetParent && document.activeElement === clear,
  };
};
