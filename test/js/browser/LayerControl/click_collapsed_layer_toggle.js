// Clicks the LayerControl toggle button. Used to prove an outside press on
// a Leaflet control (whose own toggle calls L.DomEvent.stop) still dismisses
// an open scheme dropdown, because the registry reads outside presses on the
// capture phase.
() => {
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (!ctrl) return "no-control";
  const btn = ctrl.querySelector(".foliplus-toggle-btn");
  if (!btn) return "no-toggle";
  const wasExpanded = ctrl.classList.contains("foliplus-is-expanded");
  btn.click();
  return {
    clicked: true,
    wasExpanded,
    nowExpanded: ctrl.classList.contains("foliplus-is-expanded"),
  };
};
