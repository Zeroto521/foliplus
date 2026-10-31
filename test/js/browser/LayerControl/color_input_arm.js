// Arm the activation-key regression for a style panel's color picker.
//
// `layer` selects the owning row: "overlay" for the first overlay row (a data
// layer's Fill Color row) or "color-map" for the solid-color basemap row
// (whose fill row is the color swatch). Opens that row's style panel,
// focuses the real <input type=color> used by the Fill Color row, and records
// the row's checkbox plus a capture-phase keydown log. Reading `prevented` in
// the capture listener would only ever report false, so the read step
// serialises the live getter after dispatch.
layer => {
  if (!window.__colorKeyGate) {
    window.__colorKeyGate = { records: [] };
    document.addEventListener(
      "keydown",
      e => {
        window.__colorKeyGate.records.push({
          key: e.key,
          tag: e.target.tagName.toLowerCase(),
          type: e.target.type || "",
          cls: String(e.target.className),
          get prevented() {
            return e.defaultPrevented;
          },
        });
      },
      true,
    );
  }
  window.__colorKeyGate.records = [];

  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "window.__layerCtrl missing" };
  const ui = ctrl.mgr.ui;

  const row =
    layer === "color-map"
      ? document.querySelector(
          '.foliplus-layer-item[data-layer-id="foliplus_color_map"]',
        )
      : document.querySelector(".foliplus-layer-item[data-layer-type=overlay]");
  if (!row) return { error: `row not found: ${layer}` };
  const layerId = row.getAttribute("data-layer-id");
  if (!layerId) return { error: "row has no data-layer-id" };

  ui.openStylePanel(layerId);
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { error: `style panel did not open for ${layer}` };
  const input = panel.querySelector(".foliplus-style-fill-color-input");
  if (!input) return { error: "no Fill Color input in the style panel" };
  input.focus();

  window.__colorProbe = { layerId };
  const cb = row.querySelector('input[type="checkbox"]');
  return {
    layerId,
    checkboxBefore: cb ? cb.checked : null,
    focusedTag: document.activeElement.tagName.toLowerCase(),
    focusedType: document.activeElement.type || "",
    focusedClass: String(document.activeElement.className),
    colorInputs: panel.querySelectorAll('input[type="color"]').length,
  };
};
