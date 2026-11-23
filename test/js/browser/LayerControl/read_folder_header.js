() => {
  const row = document.querySelector('.foliplus-layer-toggle-all[data-role="overlay"]');
  if (!row) return { exists: false, cleanup: null };
  // The cleanup entry lives in the role row's overflow menu now (it used to be
  // an inline button in the header, which the role row no longer has room for).
  const more = row.querySelector(".foliplus-layer-more-btn");
  if (more) more.click();
  const item = document.querySelector('[data-action="clean-empty-folders"]');
  return {
    exists: true,
    cleanup: item
      ? {
          text: item.textContent,
          ariaLabel: item.getAttribute("title"),
          disabled: item.getAttribute("aria-disabled") === "true",
        }
      : null,
  };
};
