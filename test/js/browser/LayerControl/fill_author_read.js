// Read the fill row's per-feature / by-value state, the scheme strip, and the
// fill colours actually painted on the map.
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const select = panel?.querySelector(".foliplus-style-fill-mode-select");
  const featureOption = select?.querySelector('option[value="feature"]');
  const field = panel?.querySelector(".foliplus-style-fill-field-select");
  const classes = panel?.querySelector(".foliplus-style-fill-classes-select");
  const trigger = panel?.querySelector(".foliplus-style-scheme-trigger");
  const bar = trigger?.querySelector(".foliplus-scheme-picker-bar");
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
    field: field ? field.value : null,
    classes: classes ? classes.value : null,
    schemeTitle: trigger ? trigger.title : null,
    barBlocks: bar ? bar.children.length : 0,
    barHeight: bar ? bar.getBoundingClientRect().height : 0,
    noteInPanel: !!panel?.querySelector(".foliplus-style-fill-note"),
    hasSwatch: !!swatch,
    fills,
  };
};
