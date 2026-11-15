// Reads the style panel after a Reset: it must still be open and keep focus on
// its own Reset button. Used by the browser kill test for the keep-open policy.
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  return {
    panelOpen: !!panel,
    focusIsReset:
      !!panel &&
      document.activeElement === panel.querySelector(".foliplus-style-reset-btn"),
  };
};
