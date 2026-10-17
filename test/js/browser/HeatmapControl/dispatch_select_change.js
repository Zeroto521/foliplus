sel => {
  // Dispatch a change event on the element at the given CSS selector.
  document.querySelector(sel).dispatchEvent(new Event("change"));
};
