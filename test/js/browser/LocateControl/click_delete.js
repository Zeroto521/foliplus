() => {
  // Click the floating ✕ delete icon next to the location pin.
  const x = document.querySelector("[data-del-icon]");
  if (x) x.click();
  return x !== null;
};
