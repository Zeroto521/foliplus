() => {
  // Read the coordinates text from the located marker's popup.
  const popup = document.querySelector(".foliplus-popup-content");
  return popup ? popup.textContent : null;
};
