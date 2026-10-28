() => {
  const btn = document.querySelector(
    ".foliplus-measure-ctrl .foliplus-tool-btn:not([data-mode])",
  );
  if (!btn) return false;
  btn.click();
  return true;
};
