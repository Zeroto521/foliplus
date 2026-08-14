() => {
  const x = document.querySelector("[data-del-icon].visible");
  if (x) x.click();
  return x !== null;
};
