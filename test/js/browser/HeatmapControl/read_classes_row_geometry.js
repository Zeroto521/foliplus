// Read the Method + Classes row geometry: the Method dropdown must fill the
// shared control column from its left edge, the class-count dropdown must sit
// at the compact secondary width, and the two must not overlap — the
// LayerControl by-value row's shape. The stylesheet contract is asserted in
// vitest; this probe records the rendered pixels so the browser job pins the
// geometry the CSS promises.
() => {
  const ctrl = document.querySelector(".foliplus-heatmap-ctrl");
  // The visible flex items are the shared dropdown wrappers the heatmap
  // stylesheet sizes (the native selects are display:none), so find the two
  // wrappers by the hook classes bindControls adds — the same targets the
  // CSS rules name.
  const method = ctrl?.querySelector(".foliplus-dropdown.foliplus-heatmap-method");
  const classes = ctrl?.querySelector(
    ".foliplus-dropdown.foliplus-heatmap-classes-count",
  );
  const controlCell = method?.closest(".foliplus-form-control");
  const geom = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      width: Math.round(r.width),
    };
  };
  const secondaryWidth = ctrl
    ? Math.round(
        parseFloat(
          getComputedStyle(ctrl).getPropertyValue("--foliplus-form-secondary-width"),
        ),
      )
    : null;
  const methodGeom = geom(method);
  const classesGeom = geom(classes);
  const controlGeom = geom(controlCell);
  // Guard: a 0-width measurement means the row was never laid out (panel not
  // open, no layer picked), which would make the left/width relationships
  // below trivially true. Every derived flag requires a positive width, so the
  // probe fails loudly instead of "passing" on an unmeasured panel.
  const widthsPositive = !!(
    methodGeom &&
    classesGeom &&
    controlGeom &&
    methodGeom.width > 0 &&
    classesGeom.width > 0 &&
    controlGeom.width > 0
  );
  return {
    ok: !!(method && classes && controlCell && secondaryWidth),
    widthsPositive,
    methodGeom,
    classesGeom,
    controlGeom,
    secondaryWidth,
    // The Method dropdown starts at the control cell's left edge.
    methodFillsControl: !!(widthsPositive && methodGeom.left === controlGeom.left),
    // The class-count dropdown is exactly the compact secondary width.
    classesAtSecondary: !!(widthsPositive && classesGeom.width === secondaryWidth),
    // The two controls do not overlap: the method's right edge is at or
    // before the class count's left edge.
    noOverlap: !!(widthsPositive && methodGeom.right <= classesGeom.left),
  };
};
