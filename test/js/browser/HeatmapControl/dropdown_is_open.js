// True while a portalled dropdown list is open (any .foliplus-dropdown-list not hidden).
() => {
  const list = [...document.querySelectorAll(".foliplus-dropdown-list")].find(
    l => !l.hidden,
  );
  return !!list;
};
