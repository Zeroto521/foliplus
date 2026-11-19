// Real-mouse press on the first overlay row's ⋮ button, returning its centre.
// A synthetic element.click() fires only a click event (no mousedown), so the
// registry's document-capture mousedown dismissal would never see it; the user's
// real path is a real pointer press, so this uses page.mouse after a centre read.
() => {
  const row = document.querySelector(".foliplus-layer-item[data-layer-type=overlay]");
  if (!row) return null;
  const btn = row.querySelector(".foliplus-layer-more-btn");
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
};
