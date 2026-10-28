// Reads the enum dropdown's focus, selection and hit-test state for the real
// browser keyboard test.
() => {
  const panel = document.querySelector(".foliplus-layer-filter-panel");
  const row = document.querySelector(
    '.foliplus-layer-item[data-layer-id="__filter_enum_keyboard_probe__"]',
  );
  const trigger =
    panel && panel.querySelector(".foliplus-filter-enum .foliplus-dropdown-trigger");
  const list = document.querySelector(".foliplus-dropdown-list");
  const active = document.activeElement;
  const optionEls = () =>
    Array.from(document.querySelectorAll(".foliplus-dropdown-option"));
  const hitTest = element => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return Boolean(hit && (hit === element || element.contains(hit)));
  };
  const rectOf = element => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
    };
  };
  return {
    panelOpen: Boolean(panel),
    panelInDocument: Boolean(panel && document.body.contains(panel)),
    triggerTag: trigger ? trigger.tagName : null,
    ariaExpanded: trigger ? trigger.getAttribute("aria-expanded") : null,
    popupOpen: Boolean(list && list.hidden === false),
    popupInDocument: Boolean(list && document.body.contains(list)),
    popupParentTag: list && list.parentElement ? list.parentElement.tagName : null,
    popupInsidePanel: Boolean(list && panel && panel.contains(list)),
    nativeMultipleSelects: document.querySelectorAll("select[multiple]").length,
    options: optionEls().map(el => el.getAttribute("data-value")),
    selected: optionEls()
      .filter(el => el.getAttribute("aria-selected") === "true")
      .map(el => el.getAttribute("data-value")),
    activeIsTrigger: active === trigger,
    activeIsOption: optionEls().includes(active),
    activeTag: active ? active.tagName : null,
    activeRowId: (() => {
      if (!active || !active.closest) return null;
      if (
        active.closest(
          ".foliplus-layer-filter-panel, .foliplus-layer-attrs-panel, .foliplus-layer-style-panel, .foliplus-dropdown-list",
        )
      ) {
        return null;
      }
      const item = active.closest(".foliplus-layer-item");
      return item ? item.getAttribute("data-layer-id") : null;
    })(),
    allOptionsHitTestable: optionEls().every(hitTest),
    triggerRect: rectOf(trigger),
    popupRect: rectOf(list),
    panelRect: rectOf(panel),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    columnOpen: row
      ? Array.from(row.querySelectorAll(".foliplus-layer-count")).map(cell =>
          cell.textContent.trim(),
        )
      : [],
  };
};
