() => {
  // Multi-window color probes on the latest export canvas.
  // window._probes = [{ name, x, y, w, h, color: [r,g,b] }, ...]
  // A probe may omit x/y/w/h to scan the entire canvas.
  const canvases = window._capturedCanvases || [];
  if (canvases.length === 0) return null;
  const c = canvases[canvases.length - 1];
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  const probes = window._probes || [];
  const tol = window._sampleTol || 30;
  const alphaMin = window._sampleAlphaMin || 200;
  const result = {};

  for (const p of probes) {
    const [r, g, b] = p.color;
    const hasWin = p.x !== undefined && p.y !== undefined;
    const sx = hasWin ? Math.max(0, Math.floor(p.x)) : 0;
    const sy = hasWin ? Math.max(0, Math.floor(p.y)) : 0;
    const sw = hasWin ? Math.min(c.width - sx, Math.floor(p.w)) : c.width;
    const sh = hasWin ? Math.min(c.height - sy, Math.floor(p.h)) : c.height;
    if (sw <= 0 || sh <= 0) {
      result[p.name] = { hit: 0, total: 0, empty: true };
      continue;
    }
    const { data } = ctx.getImageData(sx, sy, sw, sh);
    let hit = 0;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) total++;
      const near =
        Math.abs(data[i] - r) <= tol &&
        Math.abs(data[i + 1] - g) <= tol &&
        Math.abs(data[i + 2] - b) <= tol &&
        data[i + 3] > alphaMin;
      if (near) hit++;
    }
    result[p.name] = { hit, total };
  }
  return result;
};
