([sel, value]) => {
  // Set a select's value by CSS selector (used by autofield tests).
  document.querySelector(sel).value = value;
};
