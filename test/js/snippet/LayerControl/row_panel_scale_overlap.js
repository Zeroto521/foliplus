// Probes whether the real bottom-left ScaleControl ever covers the open row
// panel. Reports the overlap region and what elementFromPoint hits there.
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const scale = document.querySelector(".foliplus-scale-wrap");
  if (!panel || !scale) return { ok: false, reason: "missing" };
  const pr = panel.getBoundingClientRect();
  const sr = scale.getBoundingClientRect();
  const overlap = !(
    pr.right < sr.left ||
    pr.left > sr.right ||
    pr.bottom < sr.top ||
    pr.top > sr.bottom
  );
  if (!overlap) return { ok: true, overlap: false };
  const cx = Math.max(pr.left, sr.left) + 10;
  const cy = Math.max(pr.top, sr.top) + 10;
  const hit = document.elementFromPoint(cx, cy);
  return {
    ok: true,
    overlap: true,
    hitIsPanel: hit ? !!hit.closest(".foliplus-layer-style-panel") : false,
    hit: hit ? hit.className || hit.tagName : null,
  };
};
