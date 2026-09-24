() => {
  // Deselect the whole basemap group through its toggle-all checkbox — the same
  // gesture a user makes to leave every basemap unchecked. Only the base group
  // is touched, so overlays keep their state and a test can leave a marker on
  // the map while the container enters the empty-basemap state.
  //
  // Before/after of the base rows' boxes plus the container class are reported
  // so a failure names which half broke.
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (!ctrl) return { ok: false, reason: "no layer panel" };
  if (!ctrl.classList.contains("expanded")) {
    ctrl.querySelector(".foliplus-toggle-btn").click();
  }
  const sel = '.foliplus-layer-toggle-all[data-group="base"] [data-role="toggle-all"]';
  const cb = ctrl.querySelector(sel);
  if (!cb) return { ok: false, reason: "no base group toggle-all" };
  const readRows = () =>
    Array.from(
      ctrl.querySelectorAll('.foliplus-layer-item[data-layer-type="base"] input[type="checkbox"]'),
    ).map(c => c.checked);
  const before = readRows();
  cb.click();
  const cont = document.querySelector(".leaflet-container");
  return {
    ok: true,
    before,
    after: readRows(),
    noBaseMap: cont.classList.contains("no-base-map"),
    allChecked: cb.checked,
  };
};
