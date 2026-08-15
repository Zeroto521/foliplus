() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return false;
  const overlay = document.querySelector(
    '.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)',
  );
  const base = document.querySelector('.foliplus-layer-item[data-layer-type="base"]');
  if (!overlay || !base) return false;
  // Dragstart on the overlay arms the UI drag state (sets its dragIdx)
  overlay.dispatchEvent(
    new DragEvent("dragstart", { bubbles: true, cancelable: true }),
  );
  // Dragover onto the base group item triggers the blocked-reorder hint
  base.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true }));
  return true;
};
