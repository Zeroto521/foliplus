() => {
  const row = document.querySelector('.foliplus-layer-toggle-all[data-role="overlay"]');
  const btn = row ? row.querySelector(".foliplus-layer-clean-folders") : null;
  if (btn) btn.click();
  const after = document.querySelector(
    '.foliplus-layer-toggle-all[data-role="overlay"]',
  );
  const afterBtn = after ? after.querySelector(".foliplus-layer-clean-folders") : null;
  return {
    clicked: Boolean(btn),
    remainingCount: afterBtn
      ? Number((afterBtn.textContent || "").match(/[（(](\d+)[)）]/)?.[1])
      : 0,
    buttonGone: !afterBtn,
  };
};
