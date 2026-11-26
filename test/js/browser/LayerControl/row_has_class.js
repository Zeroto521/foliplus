// Whether the row addressed by selector carries className.
([selector, className]) => {
  const row = document.querySelector(selector);
  return row ? row.classList.contains(className) : null;
};
