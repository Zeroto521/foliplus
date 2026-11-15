// Arms distance mode without drawing, so the cursor readout is live.
// The readout only tracks the pointer while a drawing mode is armed.
() => {
  window.__measureManager.setMode("distance");
  return window.__measureManager.currentMode;
};
