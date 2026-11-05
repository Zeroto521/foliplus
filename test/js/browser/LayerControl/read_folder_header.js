() => {
  const row = document.querySelector('.foliplus-layer-toggle-all[data-role="overlay"]');
  if (!row) return { exists: false, cleanup: null };
  const btn = row.querySelector('.foliplus-clean-empty-folders');
  return {
    exists: true,
    cleanup: btn ? { text: btn.textContent, ariaLabel: btn.getAttribute('aria-label'), count: btn.getAttribute('data-empty-count') } : null,
  };
}
