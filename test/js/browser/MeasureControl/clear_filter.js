() => {
  const clear = document.querySelector(".foliplus-filter-clear");
  if (!clear || clear.disabled) return false;
  clear.click();
  return true;
};
