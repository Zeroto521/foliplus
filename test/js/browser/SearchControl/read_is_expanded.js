() => {
  const c = document.querySelector(".foliplus-search");
  return (
    c.classList.contains("foliplus-is-expanded") &&
    !c.classList.contains("foliplus-is-collapsed")
  );
};
