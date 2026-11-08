() => {
  const canvases = window._capturedCanvases || [];
  if (canvases.length === 0) return { found: false };
  const c = canvases[canvases.length - 1];
  const ctx = c.getContext("2d");
  if (!ctx) return { found: false };
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let nonBg = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const isBg =
      Math.abs(data[i] - 221) < 20 &&
      Math.abs(data[i + 1] - 221) < 20 &&
      Math.abs(data[i + 2] - 221) < 20;
    if (!isBg) nonBg++;
  }
  return { found: true, nonBg };
};
