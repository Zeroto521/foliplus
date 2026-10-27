// Reads the enum listbox's focus, selection and hit-test state for the real
// browser keyboard test.
() => {
  const panel = document.querySelector(".foliplus-layer-filter-panel");
  const select = panel && panel.querySelector(".foliplus-filter-enum");
  const row = document.querySelector(
    '.foliplus-layer-item[data-layer-id="__filter_enum_keyboard_probe__"]',
  );
  const active = document.activeElement;
  const options = select ? Array.from(select.options) : [];
  const hitTest = element => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return Boolean(hit && (hit === element || element.contains(hit)));
  };
  return {
    panelOpen: Boolean(panel),
    panelInDocument: Boolean(panel && document.body.contains(panel)),
    selectTag: select ? select.tagName : null,
    size: select ? select.getAttribute("size") : null,
    selected: options.filter(option => option.selected).map(option => option.value),
    optionValues: options.map(option => option.value),
    activeIsSelect: active === select,
    activeTag: active ? active.tagName : null,
    activeRowId: (() => {
      if (!active || !active.closest) return null;
      if (
        active.closest(
          ".foliplus-layer-filter-panel, .foliplus-layer-attrs-panel, .foliplus-layer-style-panel",
        )
      ) {
        return null;
      }
      const item = active.closest(".foliplus-layer-item");
      return item ? item.getAttribute("data-layer-id") : null;
    })(),
    allOptionsHitTestable: options.every(hitTest),
    selectRect: select
      ? (() => {
          const rect = select.getBoundingClientRect();
          return {
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
          };
        })()
      : null,
    panelRect: panel
      ? (() => {
          const rect = panel.getBoundingClientRect();
          return {
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
          };
        })()
      : null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: select
      ? { client: select.clientHeight, scroll: select.scrollHeight }
      : null,
    columnOpen: row
      ? Array.from(row.querySelectorAll(".foliplus-layer-count")).map(cell =>
          cell.textContent.trim(),
        )
      : [],
  };
};
