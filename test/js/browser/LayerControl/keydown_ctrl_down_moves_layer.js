() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const layers = api.layers;
  if (layers.length < 2) return null;
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  // 目标: registry 中 index 0 的层（先取 id 字符串，避免 view 动态变化）
  const targetId = layers[0].id;
  const item = panel.querySelector(
    `[data-layer-id="${CSS.escape(targetId)}"]`,
  );
  if (!item) return null;
  item.focus();
  item.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true, bubbles: true }),
  );
  const newIdx = api.layers.findIndex(l => l.id === targetId);
  return { initialIdx: 0, newIdx, moved: newIdx === 1 };
};
