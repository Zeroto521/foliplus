() => {
  // Check every overlay row that is currently unchecked: this is the exact
  // action the user reported -- clicking a `show=False` layer on in the panel.
  //
  // Setting `checked = true` instead of calling click(): a click toggles, and a
  // row the page already rendered checked would toggle back off. Mirror of
  // hide_then_reload.js in the opposite direction.
  const SEL = '[data-layer-type]:not([data-layer-type="base"])';
  const rows = document.querySelectorAll(SEL);
  let checked = 0;
  for (const row of rows) {
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb && !cb.checked) {
      cb.checked = true;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      checked += 1;
    }
  }
  return {
    rows: rows.length,
    checked,
    stillUnchecked: document.querySelectorAll(
      `${SEL} input[type="checkbox"]:not(:checked)`,
    ).length,
  };
};
