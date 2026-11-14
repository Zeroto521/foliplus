// Read the crop box's geometry and drag state.
() => {
  const box = document.querySelector(".foliplus-export-box");
  if (!box) return { error: "no export box" };
  const r = box.getBoundingClientRect();
  return {
    left: Math.round(r.left),
    top: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
    centerX: Math.round(r.left + r.width / 2),
    centerY: Math.round(r.top + r.height / 2),
    draggingClass: box.classList.contains("foliplus-is-dragging"),
  };
};
