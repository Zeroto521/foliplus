() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return false;
  // Target the overlay group's toggle-all row instead of guessing which layer
  // row belongs to the overlay: a map with only base layers returns null below,
  // and the overlay row is the one that carries the overlay group's drag handle.
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
