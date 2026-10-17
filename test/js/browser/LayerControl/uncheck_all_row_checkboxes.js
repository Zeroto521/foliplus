// Uncheck every overlay checkbox on the panel — dispatches a change event so
// the state actually mutates.
() =>
  [...document.querySelectorAll(".foliplus-layer-item input[type=checkbox]")].forEach(
    i => {
      i.checked = false;
      i.dispatchEvent(new Event("change", { bubbles: true }));
    },
  );
