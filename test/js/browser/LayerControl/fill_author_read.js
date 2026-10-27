// Read the fill row's per-feature state, the tooltip that explains it, and the
// fill colours actually painted on the map.
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const select = panel?.querySelector(".foliplus-style-fill-mode-select");
  const featureOption = select?.querySelector('option[value="feature"]');
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
    noteInPanel: !!panel?.querySelector(".foliplus-style-fill-note"),
    selectTitle: select ? select.title : null,
    selectDescription: select ? select.getAttribute("aria-description") : null,
    optionTitle: featureOption ? featureOption.title : null,
    hasSwatch: !!swatch,
    fills,
  };
};
