() => {
  const mm = window.__measureManager;
  const row = document.querySelector(
    '.foliplus-layer-item[data-layer-id="foliplus_measure"]',
  );
  const count = row ? row.querySelector(".foliplus-layer-count") : null;
  const result = document.querySelector(".foliplus-filter-result");
  const disclosure = document.querySelector(".foliplus-filter-enum");
  const summary = document.querySelector(".foliplus-filter-enum-trigger");
  return {
    stored: mm.measurements.map(m => m.type),
    visible: mm.visibleMeasurements().map(m => m.type),
    filter: mm.measureFilter || null,
    options: Array.from(
      document.querySelectorAll(".foliplus-filter-enum-option input[data-value]"),
    ).map(box => box.dataset.value),
    summary: summary ? summary.textContent : null,
    detailsOpen: disclosure ? disclosure.open : null,
    count: count ? count.textContent.trim() : null,
    result: result ? result.textContent : null,
    paths: document.querySelectorAll(".foliplus-measure-path").length,
    labels: document.querySelectorAll(".foliplus-measure-label").length,
    dots: document.querySelectorAll(".foliplus-measure-node, .foliplus-dot").length,
  };
};
