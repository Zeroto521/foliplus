// Arm the row-panel close-X key regression: open the requested panel
// ("attrs" | "style") on the first overlay row, record the owning layer's
// checkbox state, and put focus on the header's real close <button>.
//
// A capture-phase keydown log records what foliplus did with the key after
// Chromium's own routing; the read step serialises the live `prevented`
// getter AFTER dispatch (reading it in the capture listener itself would only
// ever report false).
kind => {
  if (!window.__closeKeyGate) {
    window.__closeKeyGate = { records: [] };
    document.addEventListener(
      "keydown",
      e => {
        window.__closeKeyGate.records.push({
          key: e.key,
          tag: e.target.tagName.toLowerCase(),
          cls: String(e.target.className),
          get prevented() {
            return e.defaultPrevented;
          },
        });
      },
      true,
    );
  }
  window.__closeKeyGate.records = [];

  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "window.__layerCtrl missing" };
  const ui = ctrl.mgr.ui;

  const ROW = ".foliplus-layer-item[data-layer-type=overlay]";
  const row = document.querySelector(ROW);
  if (!row) return { error: "no overlay row" };
  const layerId = row.getAttribute("data-layer-id");
  if (!layerId) return { error: "row has no data-layer-id" };

  if (kind === "attrs") ui.openAttrsPanel(row);
  else if (kind === "style") ui.openStylePanel(layerId);
  else return { error: "unknown panel kind: " + kind };

  const PANEL =
    kind === "attrs" ? ".foliplus-layer-attrs-panel" : ".foliplus-layer-style-panel";
  const panel = document.querySelector(PANEL);
  if (!panel) return { error: "panel did not open: " + PANEL };
  const close = panel.querySelector(".foliplus-panel-header .foliplus-close-btn");
  if (!close) return { error: "close button not found in " + PANEL };
  close.focus();

  const cb = row.querySelector('input[type="checkbox"]');
  return {
    layerId,
    panel: PANEL,
    checkboxBefore: cb ? cb.checked : null,
    focusedTag: document.activeElement.tagName.toLowerCase(),
    focusedClass: String(document.activeElement.className),
  };
};
