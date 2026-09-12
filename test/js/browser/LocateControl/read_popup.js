() => {
  // Read the located marker's popup: its text, and the size of the spinner
  // inside it if one is present. The spinner carries a viewBox but no
  // width/height, so it has no intrinsic size — inside a flex popup it
  // expands to fill the box unless common.css pins it to `1em`.
  const popup = document.querySelector(".foliplus-popup-content");
  if (!popup) return null;
  const svg = popup.querySelector("svg.foliplus-spin");
  return {
    text: popup.textContent,
    spinner: svg
      ? (() => {
          const r = svg.getBoundingClientRect();
          return {
            width: Number(r.width.toFixed(1)),
            height: Number(r.height.toFixed(1)),
          };
        })()
      : null,
  };
};
