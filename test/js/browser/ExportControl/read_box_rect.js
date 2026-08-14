() => {
  // Read the crop box's current bounding rect.
  const box = document.querySelector(".foliplus-export-box");
  const r = box.getBoundingClientRect();
  return { l: r.left, t: r.top, w: r.width, h: r.height };
};
