() => {
  // Read the most recently captured canvas — the renderer's own output
  // canvas — and count pixels matching a caller-specified colour. The caller
  // picks the "content" colour: a canvas layer's red fill, a label's white
  // text, or the annotation canvas's pixel signature. Returns the hit count
  // and the total non-transparent pixel count so a test can tell "nothing
  // drawn at all" (total 0) from "drawn something, but not what I asked for"
  // (total > 0, hit 0). Returns null if no canvas was captured, so the
  // caller can distinguish a failed hook from an empty export.
  //
  // Picking the last element — not the largest — because the test's own canvas
  // layer (drawn before the hook is installed) can be the same size as the
  // export canvas; only recency is unambiguous.
  const canvases = window._capturedCanvases || [];
  if (canvases.length === 0) return null;
  const c = canvases[canvases.length - 1];
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const [r, g, b] = window._sampleColor || [230, 30, 30];
  const tol = window._sampleTol || 30;
  const alphaMin = window._sampleAlphaMin || 200;
  let hits = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) total++;
    const near =
      Math.abs(data[i] - r) <= tol &&
      Math.abs(data[i + 1] - g) <= tol &&
      Math.abs(data[i + 2] - b) <= tol &&
      data[i + 3] > alphaMin;
    if (near) hits++;
  }
  return { found: true, hit: hits, total, w: c.width, h: c.height };
}
