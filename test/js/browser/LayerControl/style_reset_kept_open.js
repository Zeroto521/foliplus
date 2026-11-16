// Reads the style panel after a Reset: it must still be open, its Reset
// disabled again (the layer is back on its declared style), and focus inside
// the panel. The reset outcome focuses the rebuilt button only while it is
// usable; a disabled trigger cannot take focus, so the fallback is the panel's
// first usable control. Used by the browser kill test for the keep-open policy.
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const reset = panel && panel.querySelector(".foliplus-style-reset-btn");
  return {
    panelOpen: !!panel,
    resetDisabled: !!(reset && reset.disabled),
    focusInPanel: !!panel && panel.contains(document.activeElement),
  };
};
