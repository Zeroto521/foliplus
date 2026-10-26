// Reports the pin state of the row panels currently in the document, plus a
// freshly built row panel that was never pinned.
//
// The shared .foliplus-row-panel card is plain absolute by default; only a
// caller that builds it inside the layer list's scroll box and opts into
// pinRowPanel gets the fixed, placed variant. This read is what proves both
// halves: the panels this PR opens are pinned and in the viewport, and a card
// that skips the helper (a new caller such as a filter panel) is not moved to
// the viewport corner.
() => {
  const read = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      position: getComputedStyle(el).position,
      pinned: el.classList.contains("foliplus-is-pinned"),
      inViewport:
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= innerHeight &&
        rect.right <= innerWidth,
    };
  };

  const leafletCore =
    (window.foliplus && window.foliplus.core && window.foliplus.core.leaflet) || {};
  const factory = leafletCore.createRowPanel;
  let fixture;
  if (typeof factory === "function") {
    const { panel } = factory({
      cssClass: "foliplus-unpinned-probe",
      title: "Probe",
      iconSvg: "<svg></svg>",
      closeTitle: "Close",
      iconClass: "foliplus-header-icon",
    });
    document.body.appendChild(panel);
    fixture = {
      fromFactory: true,
      position: getComputedStyle(panel).position,
      pinned: panel.classList.contains("foliplus-is-pinned"),
    };
    panel.remove();
  } else {
    // The runtime registry is generated per build; fall back to the class
    // contract itself so the test still pins the stylesheet default.
    const el = document.createElement("div");
    el.className = "foliplus-panel foliplus-row-panel";
    document.body.appendChild(el);
    fixture = {
      fromFactory: false,
      position: getComputedStyle(el).position,
      pinned: el.classList.contains("foliplus-is-pinned"),
    };
    el.remove();
  }

  return {
    style: read(".foliplus-layer-style-panel"),
    attrs: read(".foliplus-layer-attrs-panel"),
    fixture,
  };
};
