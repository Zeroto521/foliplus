() => {
  const row = document.querySelector('.foliplus-layer-toggle-all[data-role="overlay"]');
  const btn = row ? row.querySelector('.foliplus-clean-empty-folders') : null;
  if (btn) btn.click();
  const after = document.querySelector('.foliplus-layer-toggle-all[data-role="overlay"]');
  const afterBtn = after ? after.querySelector('.foliplus-clean-empty-folders') : null;
  return {
    clicked: Boolean(btn),
    remainingCount: afterBtn ? Number(afterBtn.getAttribute('data-empty-count')) : 0,
    buttonGone: !afterBtn,
  };
}
