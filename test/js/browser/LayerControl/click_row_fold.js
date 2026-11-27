// Clicks a row's fold chevron (role header or folder row).
selector => {
  const btn = document.querySelector(selector + " .foliplus-layer-fold-btn");
  if (!btn) return false;
  btn.click();
  return true;
};
