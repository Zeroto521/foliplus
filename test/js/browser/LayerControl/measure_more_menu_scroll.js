// Opens the ⋮ overflow menu on the first layer row and measures whether the
// menu scrolls. A small menu (4-5 items) must NOT scroll: the card's regression
// is that a tiny menu showed both a horizontal and a vertical scrollbar because
// the shell set overflow-y: auto (which computes overflow-x: auto too) and the
// placement engine capped maxHeight below the natural height.
//
// Reads the scrollbar geometry and the resolved scrollbar recipe so the Python
// side asserts both the no-scroll invariant (this run) and that the shared
// thin/stable-gutter recipe actually applied (computed values).
() => {
  const row = document.querySelector(".foliplus-layer-item");
  if (!row) return { ok: false, reason: "no-row" };
  const moreBtn = row.querySelector(".foliplus-layer-more-btn");
  if (!moreBtn) return { ok: false, reason: "no-more-btn" };
  moreBtn.click();
  const menu = row.querySelector(".foliplus-layer-more-menu");
  if (!menu) return { ok: false, reason: "no-menu" };
  // A fresh click is synchronous in the DOM, but the menu opens and places in
  // the same task; measure after the browser has painted the open state.
  return new Promise(resolve => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const cs = getComputedStyle(menu);
        const rect = menu.getBoundingClientRect();
        resolve({
          ok: true,
          itemCount: menu.querySelectorAll("button").length,
          // The no-scroll invariant: content fits its scrollport on both axes.
          scrollWidth: menu.scrollWidth,
          clientWidth: menu.clientWidth,
          scrollHeight: menu.scrollHeight,
          clientHeight: menu.clientHeight,
          noHScroll: menu.scrollWidth <= menu.clientWidth,
          noVScroll: menu.scrollHeight <= menu.clientHeight,
          // Resolved recipe: the shared scrollbar tokens actually applied.
          scrollbarWidth: cs.scrollbarWidth,
          scrollbarGutter: cs.scrollbarGutter,
          overflowX: cs.overflowX,
          overflowY: cs.overflowY,
          maxHeight: cs.maxHeight,
          width: rect.width,
          // The longest label ("Confirm Delete") must be fully visible: the menu
          // is at least as wide as its widest item, so no horizontal clip.
          menuWidth: rect.width,
          // The delete entry is identified STRUCTURALLY (its data-action),
          // never by its label: the label is localized, so a text match would
          // fail in any non-English locale. It is the widest item (its armed
          // label is longer than the resting one), so it must also fit its own
          // box without clipping.
          deleteEntry: (() => {
            const btn = menu.querySelector('button[data-action="delete-layer"]');
            if (!btn) return null;
            return {
              clipped: btn.scrollWidth > btn.clientWidth,
              width: btn.getBoundingClientRect().width,
            };
          })(),
        });
      }),
    );
  });
};
