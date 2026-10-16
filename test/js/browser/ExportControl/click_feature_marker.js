() =>
  window.__featureMarker
    .getElement()
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
