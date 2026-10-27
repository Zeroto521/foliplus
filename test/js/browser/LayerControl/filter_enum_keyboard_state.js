// Reads the enum disclosure's focus, checkbox and hit-test state for the real
// browser keyboard test.
() => {
  const panel = document.querySelector(".foliplus-layer-filter-panel");
  const details = panel && panel.querySelector(".foliplus-filter-enum");
  const summary = panel && panel.querySelector(".foliplus-filter-enum-trigger");
  const row = document.querySelector(
    '.foliplus-layer-item[data-layer-id="__filter_enum_keyboard_probe__"]',
  );
  const active = document.activeElement;
  const boxes = panel
    ? Array.from(
        panel.querySelectorAll(".foliplus-filter-enum-option input[type=checkbox]"),
      )
    : [];
  const options = boxes.filter(box => box.dataset.value);
  const last = options[options.length - 1] || null;
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
    detailsOpen: details ? details.open : null,
    summaryText: summary ? summary.textContent : null,
    activeTag: active ? active.tagName : null,
    activeType: active ? active.getAttribute("type") : null,
    activeValue:
      active && active.getAttribute ? active.getAttribute("data-value") : null,
    activeIsSummary: active === summary,
    activeIsRow: active === row,
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
    checked: boxes.filter(box => box.checked).map(box => box.dataset.value || "all"),
    optionValues: options.map(box => box.dataset.value),
    optionCount: options.length,
    allOptionsHitTestable: options.every(box => hitTest(box)),
    lastOptionHitTestable: hitTest(last),
    optionHits: options.map(box => hitTest(box)),
    // The disclosure flows inside the panel: its list must not be positioned
    // as a floating layer.
    listPosition: (() => {
      const list = panel && panel.querySelector(".foliplus-filter-enum-list");
      return list ? getComputedStyle(list).position : null;
    })(),
    listRect: (() => {
      const list = panel && panel.querySelector(".foliplus-filter-enum-list");
      if (!list) return null;
      const rect = list.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      };
    })(),
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
    columnOpen: row
      ? Array.from(row.querySelectorAll(".foliplus-layer-count")).map(cell =>
          cell.textContent.trim(),
        )
      : [],
  };
};
