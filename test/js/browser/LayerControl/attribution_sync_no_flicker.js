() => {
  const map = window.map;
  if (!map) return { error: "no window.map" };

  const rowByName = name =>
    [...document.querySelectorAll(".foliplus-layer-item")].find(
      r => r.querySelector(".foliplus-layer-label")?.textContent?.trim() === name,
    );

  // B starts unchecked. Click B's checkbox, then read the attribution table
  // in the SAME JS task — no await, no rAF, no setTimeout. Leaflet's layeradd
  // fires addAttribution synchronously during the click; if syncAttribution
  // is debounced, the table still holds both A's and B's attrs at this
  // instant. The synchronous fix in visibility.ts clears the table right
  // after the click is processed, before the debounced enforceOrder runs.
  // A was added first, so it sits at registry index 0 (topmost in z-order)
  // and its attr wins regardless of the click order.
  const bRow = rowByName("B");
  if (!bRow) return { error: "no row for B" };
  bRow.querySelector('input[type="checkbox"]').click();

  return {
    entries: { ...map.attributionControl._attributions },
  };
};
