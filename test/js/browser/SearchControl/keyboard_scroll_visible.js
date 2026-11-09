() => {
  // Drive the cursor with ArrowDown and report whether the active row stays
  // within the panel viewport after each move. The active row is the one with
  // the cursor's active class (foliplus-search-result-active — confirm from
  // SearchControl interaction). If the panel scrolls internally, scrollTop
  // advances and the active row's rect stays inside the panel's rect.
  const panel = document.querySelector(".foliplus-search-result-panel");
  const input = document.querySelector(".foliplus-search input");
  if (!panel || !input) return { ok: false, reason: "no-panel-or-input" };
  const rows = () => Array.from(panel.querySelectorAll(".foliplus-search-result-item"));
  const activeRow = () => rows().find(r => r.classList.contains("foliplus-is-active"));
  const down = () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
  };
  const sample = () => {
    const pr = panel.getBoundingClientRect();
    const ar = activeRow()?.getBoundingClientRect();
    return {
      scrollTop: panel.scrollTop,
      activeIdx: rows().indexOf(activeRow()),
      activeCount: rows().length,
      activeInView: !!ar && ar.top >= pr.top - 1 && ar.bottom <= pr.bottom + 1,
      activeTop: ar ? ar.top : null,
      activeBottom: ar ? ar.bottom : null,
      panelTop: pr.top,
      panelBottom: pr.bottom,
    };
  };
  const samples = [];
  // Move down through the list until the end, sampling each step.
  for (let i = 0; i < 20; i++) {
    down();
    samples.push(sample());
  }
  const anyScrolled = samples.some(s => s.scrollTop > 0);
  const allActiveInView = samples.every(s => s.activeInView);
  return { ok: true, samples, anyScrolled, allActiveInView };
};
