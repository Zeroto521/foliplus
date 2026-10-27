// Reads the enum popup's focus, selection and hit-test state for the real
// browser keyboard test.
() => {
  const panel = document.querySelector(".foliplus-layer-filter-panel");
  const list = panel && panel.querySelector(".foliplus-filter-enum-list");
  const trigger = panel && panel.querySelector(".foliplus-filter-enum-trigger");
  const row = document.querySelector(
    '.foliplus-layer-item[data-layer-id="__filter_enum_keyboard_probe__"]',
  );
  const active = document.activeElement;
  const options = panel
    ? Array.from(panel.querySelectorAll(".foliplus-filter-enum-option"))
    : [];
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
    listOpen: list ? !list.hidden : null,
    expanded: trigger ? trigger.getAttribute("aria-expanded") : null,
    triggerText: trigger ? trigger.textContent : null,
    activeClass: active && active.className ? String(active.className) : null,
    activeValue:
      active && active.getAttribute ? active.getAttribute("data-value") : null,
    activeIsTrigger: active === trigger,
    activeIsRow: active === row,
    // The row id only counts when focus actually sits on row chrome: panel
    // controls are DOM descendants of the row too, so a plain closest() would
    // report the owner row for a focused panel option.
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
    selected: options.map(option => option.getAttribute("aria-selected")),
    optionCount: options.length,
    allOptionsHitTestable: options.every(hitTest),
    lastOptionHitTestable: hitTest(last),
    optionHits: options.map(hitTest),
    optionRects: options.map(option => {
      const rect = option.getBoundingClientRect();
      return {
        value: option.getAttribute("data-value"),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      };
    }),
    listRect: list
      ? (() => {
          const rect = list.getBoundingClientRect();
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
    listScrollable: list
      ? { client: list.clientHeight, scroll: list.scrollHeight }
      : null,
    clip: (() => {
      let node = list ? list.parentElement : null;
      while (node) {
        const style = getComputedStyle(node);
        if (style.overflowY !== "visible") {
          const rect = node.getBoundingClientRect();
          return {
            overflowY: style.overflowY,
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
          };
        }
        node = node.parentElement;
      }
      return null;
    })(),
    columnOpen: row
      ? Array.from(row.querySelectorAll(".foliplus-layer-count")).map(cell =>
          cell.textContent.trim(),
        )
      : [],
  };
};
