() => {
  const c = document.querySelector(".foliplus-measure-ctrl");
  return (
    c.classList.contains("foliplus-is-expanded") &&
    !c.classList.contains("foliplus-is-collapsed")
  );
};
