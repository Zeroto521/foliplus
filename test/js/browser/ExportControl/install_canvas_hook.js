() => {
  window._capturedCanvases = [];
  const orig = document.createElement.bind(document);
  document.createElement = function (tag, ...args) {
    const el = orig(tag, ...args);
    if (tag === "canvas") {
      window._capturedCanvases.push(el);
    }
    return el;
  };
};
