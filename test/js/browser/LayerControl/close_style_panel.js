// Presses the style drawer's close button in the panel header.
() => {
  const close = document.querySelector(
    ".foliplus-layer-style-panel .foliplus-close-btn",
  );
  if (!close) return false;
  close.click();
  return true;
};
