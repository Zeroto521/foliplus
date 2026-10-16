() => {
  const h = document.querySelector(".foliplus-export-handle");
  const c = document.querySelector(".foliplus-export-center");
  return {
    handle: getComputedStyle(h).borderRadius,
    center: getComputedStyle(c).borderRadius,
  };
};
