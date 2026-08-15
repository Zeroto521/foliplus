() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return false;
  const overlay = document.querySelector(
    '.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)',
  );
  const base = document.querySelector('.foliplus-layer-item[data-layer-type="base"]');
  if (!overlay || !base) return false;
  api.ui.dragIdx = parseInt(overlay.dataset.index, 10);
  const ev = new Event("dragover", { bubbles: true, cancelable: true });
  base.dispatchEvent(ev);
  return true;
};
