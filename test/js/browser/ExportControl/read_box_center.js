() => {
  const box = document.querySelector(".foliplus-export-box");
  const center = document.querySelector(".foliplus-export-center");
  if (!box || !center) return { error: "no box/center" };
  const br = box.getBoundingClientRect();
  const cr = center.getBoundingClientRect();
  return {
    boxLeft: br.left,
    boxTop: br.top,
    centerX: cr.left + cr.width / 2,
    centerY: cr.top + cr.height / 2,
  };
};
