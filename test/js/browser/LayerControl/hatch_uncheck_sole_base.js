async () => {
  // Regression guard: the single-basemap uncheck path must still turn the
  // hatch on. This is the pre-existing behavior pinned here so a later
  // refactor that drops the trigger leaves the honest empty state visibly
  // broken, not just a failing judgement.
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (!ctrl) return { error: "no layer panel" };
  if (!ctrl.classList.contains("foliplus-is-expanded")) {
    ctrl.querySelector(".foliplus-toggle-btn").click();
  }
  await new Promise(r => setTimeout(r, 100));

  const rows = Array.from(
    ctrl.querySelectorAll(
      '.foliplus-layer-item[data-layer-type="base"] input[type="checkbox"]',
    ),
  );
  const map = document.querySelector(".leaflet-container");
  if (!map) return { error: "no map" };
  const hasHatch = () => map.classList.contains("foliplus-no-base-map");

  // Uncheck every base row one at a time, so the state is not the
  // whole-group-toggle shortcut — this exercises the same `syncNoBasemap`
  // call site a user click goes through.
  const before = {
    rows: rows.length,
    hatch: hasHatch(),
    checked: rows.map(c => c.checked),
  };
  for (const cb of rows) {
    if (cb.checked) cb.click();
    await new Promise(r => setTimeout(r, 40));
  }
  const after = { hatch: hasHatch(), checked: rows.map(c => c.checked) };
  return { before, after };
};
