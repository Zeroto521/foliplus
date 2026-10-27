() => {
  const mm = window.__measureManager;
  const row = document.querySelector(
    '.foliplus-layer-item[data-layer-id="foliplus_measure"]',
  );
  const count = row ? row.querySelector(".foliplus-layer-count") : null;
  const result = document.querySelector(".foliplus-filter-result");
  const select = document.querySelector(".foliplus-filter-enum");
  const options = select ? Array.from(select.options) : [];
  return {
    stored: mm.measurements.map(m => m.type),
    visible: mm.visibleMeasurements().map(m => m.type),
    filter: mm.measureFilter || null,
    options: options.map(option => option.value),
    selected: options.filter(option => option.selected).map(option => option.value),
    selectSize: select ? Number(select.getAttribute("size")) : null,
    selectMultiple: select ? select.multiple : null,
    scroll: select
      ? { client: select.clientHeight, scroll: select.scrollHeight }
      : null,
    count: count ? count.textContent.trim() : null,
    result: result ? result.textContent : null,
    paths: document.querySelectorAll(".foliplus-measure-path").length,
    labels: document.querySelectorAll(".foliplus-measure-label").length,
    dots: document.querySelectorAll(".foliplus-measure-node, .foliplus-dot").length,
  };
};
