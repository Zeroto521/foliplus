() => {
  const canvases = window._capturedCanvases || [];
  const ec = canvases[canvases.length - 1];
  if (!ec) return { error: "no canvas", n: canvases.length };
  const ctx = ec.getContext("2d");
  const data = ctx.getImageData(0, 0, ec.width, ec.height);
  let nonTrans = 0,
    minX = 9999,
    maxX = 0,
    minY = 9999,
    maxY = 0;
  let rSum = 0,
    gSum = 0,
    bSum = 0;
  for (let i = 0; i < data.data.length; i += 4) {
    if (data.data[i + 3] > 10) {
      nonTrans++;
      const px = i / 4;
      const x = px % ec.width;
      const y = Math.floor(px / ec.width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      rSum += data.data[i];
      gSum += data.data[i + 1];
      bSum += data.data[i + 2];
    }
  }
  return {
    canvasW: ec.width,
    canvasH: ec.height,
    nonTransparent: nonTrans,
    bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    avgRGB:
      nonTrans > 0
        ? [
            Math.round(rSum / nonTrans),
            Math.round(gSum / nonTrans),
            Math.round(bSum / nonTrans),
          ]
        : null,
  };
};
