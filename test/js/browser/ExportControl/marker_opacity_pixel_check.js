() => {
  const canvases = window._capturedCanvases || [];
  if (canvases.length === 0) return { found: false };
  const c = canvases.reduce(
    (best, cv) => (cv.width * cv.height > best.width * best.height ? cv : best),
    canvases[0],
  );
  const ctx = c.getContext("2d");
  if (!ctx) return { found: false };
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let nonBg = 0;
  let sample = null;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const isBg =
      Math.abs(data[i] - 221) <= 30 &&
      Math.abs(data[i + 1] - 221) <= 30 &&
      Math.abs(data[i + 2] - 221) <= 30;
    if (!isBg) {
      nonBg++;
      if (!sample) sample = [data[i], data[i + 1], data[i + 2]];
    }
  }
  return { found: true, nonBg, sample };
};
