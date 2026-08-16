() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const layers = api.layers;
  if (layers.length < 2) return null;
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(panel.querySelectorAll(
    '.foliplus-layer-item:not(.foliplus-color-layer-item)'
  ));
  if (items.length < 2) return null;
  const item = items[0];
  item.focus();
  item.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true, bubbles: true }));
  const newIdx = api.layers.findIndex(l => l.id === layers[0].id);
  return { initialIdx: 0, newIdx, moved: newIdx === 1 };
};