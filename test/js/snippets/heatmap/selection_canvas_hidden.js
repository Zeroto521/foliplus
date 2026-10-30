() =>
  Array.from(document.querySelectorAll(".foliplus-canvas-layer")).map(el =>
    el.classList.contains("foliplus-hidden"),
  );
