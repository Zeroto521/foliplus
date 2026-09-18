() => {
  // Hide every overlay row's checkbox, so whatever the page registered -- from
  // Python or via LayerAPI -- ends up hidden. The panel is auto-expanded by the
  // test page. Only layer rows (data-layer-type present) count; the nested
  // foliplus-layer-count row reuses the parent's data-layer-id, and the color
  // row is a separate concern.
  //
  // Setting `checked = false` instead of calling click(): a click toggles the
  // control, and a checkbox that the page already rendered unchecked toggles
  // back on. A real test page is evaluated by a driver that takes a round trip
  // per call, so `if (cb.checked) cb.click()` hid the first row and then
  // unhid it -- the driver's own round trip looked like a product bug.
  const SEL = '[data-layer-type]:not([data-layer-type="base"])';
  const rows = document.querySelectorAll(SEL);
  for (const row of rows) {
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb?.checked) {
      cb.checked = false;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  return {
    rows: rows.length,
    stillChecked: document.querySelectorAll(`${SEL} input[type="checkbox"]:checked`)
      .length,
    ids: Array.from(rows).map(r => r.getAttribute("data-layer-id")),
  };
};
