opts => {
  // Playwright hands a no-argument call a null arg, so read the flag defensively.
  const keepClosed = Boolean(opts && opts.keepClosed);
  const mm = window.__measureManager;
  const row = document.querySelector(
    '.foliplus-layer-item[data-layer-id="foliplus_measure"]',
  );
  const count = row ? row.querySelector(".foliplus-layer-count") : null;
  const result = document.querySelector(".foliplus-filter-result");
  const trigger = document.querySelector(
    ".foliplus-filter-enum .foliplus-dropdown-trigger",
  );
  const list = document.querySelector(".foliplus-dropdown-list");
  const label = trigger && trigger.querySelector(".foliplus-dropdown-label");
  // Every assertion about the offered option set needs the rendered rows, so
  // open the popup the way a press on the trigger does when it is closed —
  // unless the caller is inspecting the closed state itself (the Escape test
  // must not reopen what the key just closed).
  if (!keepClosed && trigger && list && list.hidden) trigger.click();
  const optionEls = () =>
    Array.from(document.querySelectorAll(".foliplus-dropdown-option"));
  return {
    stored: mm.measurements.map(m => m.type),
    visible: mm.visibleMeasurements().map(m => m.type),
    filter: mm.measureFilter || null,
    options: optionEls().map(el => el.getAttribute("data-value")),
    selected: optionEls()
      .filter(el => el.getAttribute("aria-selected") === "true")
      .map(el => el.getAttribute("data-value")),
    popupOpen: Boolean(list && list.hidden === false),
    triggerLabel: label ? label.textContent : null,
    ariaExpanded: trigger ? trigger.getAttribute("aria-expanded") : null,
    nativeMultipleSelects: document.querySelectorAll("select[multiple]").length,
    count: count ? count.textContent.trim() : null,
    result: result ? result.textContent : null,
    paths: document.querySelectorAll(".foliplus-measure-path").length,
    labels: document.querySelectorAll(".foliplus-measure-label").length,
    dots: document.querySelectorAll(".foliplus-measure-node, .foliplus-dot").length,
  };
};
