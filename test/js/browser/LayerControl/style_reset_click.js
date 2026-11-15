// Clicks the style panel's Reset without Playwright's scroll-into-view; the
// shared reset outcome focuses the rebuilt button itself.
() => {
  const button = document.querySelector(
    ".foliplus-layer-style-panel .foliplus-style-reset-btn",
  );
  if (!button) return false;
  button.click();
  return true;
};
