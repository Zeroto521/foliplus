() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(
      '.foliplus-layer-item:not(.foliplus-color-layer-item) input[type="checkbox"]',
    ),
  );
  if (items.length < 2) return null;
  const toggleAll = document.querySelector('[data-role="toggle-all"]');
  if (!toggleAll) return null;

  const results = [];
  // Toggle first layer 5 times
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    items[0].click();
    const t1 = performance.now();
    results.push({ op: "toggle-layer-" + i, ms: +(t1 - t0).toFixed(3) });
  }

  // Toggle-all 3 times
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    toggleAll.click();
    const t1 = performance.now();
    results.push({ op: "toggle-all-" + i, ms: +(t1 - t0).toFixed(3) });
  }

  return results;
};
