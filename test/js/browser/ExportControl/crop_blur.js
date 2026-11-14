// Deliver the interruption an alt-tab produces: the window loses focus and no
// pointerup follows.
() => {
  window.dispatchEvent(new Event("blur"));
  const box = document.querySelector(".foliplus-export-box");
  const r = box?.getBoundingClientRect();
  return {
    sent: true,
    draggingClass: box ? box.classList.contains("foliplus-is-dragging") : null,
    left: r ? Math.round(r.left) : null,
    top: r ? Math.round(r.top) : null,
  };
};
