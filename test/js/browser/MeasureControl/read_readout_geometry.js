// Reads the cursor coordinate chip's box, side and text.
//
// The chip is positioned by the shared placement kernel, so the assertions
// compare its rendered box with the cursor instead of a hardcoded coordinate.
() => {
  const el = document.querySelector(".foliplus-measure-readout");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
    side: el.dataset.side,
    hidden: el.hidden,
    text: el.textContent,
  };
};
