() => {
  const canvas = window.map
    .getPane("foliplus-label-__export_ann__")
    ?.querySelector("canvas");
  if (!canvas) return 0;
  const data = canvas
    .getContext("2d")
    .getImageData(0, 0, canvas.width, canvas.height).data;
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
  return n;
};
