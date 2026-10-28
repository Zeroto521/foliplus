// Read the fill row of a layer whose fill the author *declared*
// (`foliplus={"fill": {...}}`): which arm the row opens on, the values it
// states, and the colours actually painted on the map.
//
// Separate from `fill_author_read` on purpose: that probe describes the
// read-only "Original colors" arm (#781), this one the declared by-value arm
// (#789). A declaration is not user intent, so the readouts here are the same
// control values the panel renders — no stored record is touched.
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const modeSelect = panel?.querySelector(".foliplus-style-fill-mode-select");
  const fieldSelect = panel?.querySelector(".foliplus-style-fill-field-select");
  const classesSelect = panel?.querySelector(".foliplus-style-fill-classes-select");
  const schemeTrigger = panel?.querySelector(".foliplus-style-scheme-trigger");
  const fills = [
    ...new Set(
      [...document.querySelectorAll("path.leaflet-interactive")]
        .map(p => p.getAttribute("fill"))
        .filter(Boolean),
    ),
  ].sort();
  return {
    panelOpen: !!panel,
    mode: modeSelect ? modeSelect.value : null,
    field: fieldSelect ? fieldSelect.value : null,
    classes: classesSelect ? classesSelect.value : null,
    schemeTitle: schemeTrigger ? schemeTrigger.title : null,
    // The declared ramp is the by-value arm: no solid swatch, and no
    // "Original colors" option on a layer the author did not paint per feature.
    hasSwatch: !!panel?.querySelector(".foliplus-style-fill-color-input"),
    originalAvailable: !!modeSelect?.querySelector('option[value="original"]'),
    fills,
  };
};
