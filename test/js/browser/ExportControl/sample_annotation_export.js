() => {
  // Read both the live annotation canvas and the renderer's output canvas,
  // then compare the label pixels between them. The annotation canvas holds a
  // small number of text pixels on a transparent background; the export draws
  // that canvas verbatim, so the pixel count in the export should match the
  // live canvas (up to a tolerance for alpha rounding on drawImage).
  //
  // The point is a diff assertion, not a total-count assertion: a test that
  // only checks "some pixels exist" would pass even if a component had quietly
  // dropped the labels from the export. Comparing the two canvases pins the
  // label pixels themselves.
  const canvases = window._capturedCanvases || [];
  if (canvases.length === 0) return null;
  const exportC = canvases.reduce(
    (best, cv) => (cv.width * cv.height > best.width * best.height ? cv : best),
    canvases[0],
  );
  const liveCanvas = window.map
    .getPane("foliplus-annotation-__export_ann__")
    ?.querySelector("canvas");
  if (!liveCanvas) return null;
  const readCount = c => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  };
  return {
    found: true,
    livePixels: readCount(liveCanvas),
    exportPixels: readCount(exportC),
    w: exportC.width,
    h: exportC.height,
  };
};
