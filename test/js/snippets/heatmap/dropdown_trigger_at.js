(selector) => {
  const select = document.querySelector('.foliplus-heatmap-ctrl ' + selector);
  const row = select ? select.closest('.foliplus-form-row') : null;
  const el = row ? row.querySelector('.foliplus-dropdown-trigger') : null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    name: (el.getAttribute('aria-label') || el.textContent || '').trim(),
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
    expanded: el.getAttribute('aria-expanded'),
  };
}
