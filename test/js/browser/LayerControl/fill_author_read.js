// Read the fill row's original-colours state: the read-only strip, its caption,
// the controls that must NOT be there, and the fill colours actually painted.
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const select = panel?.querySelector(".foliplus-style-fill-mode-select");
  const featureOption = select?.querySelector('option[value="feature"]');
  const original = panel?.querySelector(".foliplus-style-fill-original-column");
  const strip = panel?.querySelector(".foliplus-style-fill-original-strip");
  const caption = panel?.querySelector(".foliplus-style-fill-original-caption");
  const swatch = panel?.querySelector(".foliplus-style-fill-color-input");
  const fills = [
    ...new Set(
      [...document.querySelectorAll("path.leaflet-interactive")]
        .map(p => p.getAttribute("fill"))
        .filter(Boolean),
    ),
  ].sort();
  return {
    mode: select ? select.value : null,
    featureAvailable: !!featureOption,
    featureDisabled: featureOption ? featureOption.disabled : null,
    featureLabel: featureOption ? featureOption.textContent : null,
    note: select ? select.title : null,
    column: original ? original.textContent : null,
    stripBlocks: strip ? strip.children.length : 0,
    stripHeight: strip ? strip.getBoundingClientRect().height : 0,
    caption: caption ? caption.textContent : null,
    hasSwatch: !!swatch,
    hasField: !!panel?.querySelector(".foliplus-style-fill-field-select"),
    hasMethod: !!panel?.querySelector(".foliplus-style-fill-method-select"),
    hasClasses: !!panel?.querySelector(".foliplus-style-fill-classes-select"),
    hasScheme: !!panel?.querySelector(".foliplus-style-scheme-trigger"),
    noteInPanel: !!panel?.querySelector(".foliplus-style-fill-note"),
    fills,
  };
};
