// Read the Method + Classes row geometry: the Method dropdown must fill the
// shared control column from its left edge, the class-count dropdown must sit
// at the compact secondary width, and the two must not overlap — the
// LayerControl by-value row's shape. The stylesheet contract is asserted in
// vitest; this probe records the rendered pixels so the browser job pins the
// geometry the CSS promises.
() => {
  const ctrl = document.querySelector(".foliplus-heatmap-ctrl");
  const methodSelect = ctrl?.querySelector("select[data-heatmap-method]");
  const classesSelect = ctrl?.querySelector("select[data-heatmap-class-count]");
  // The visible control is the shared dropdown wrapper that owns each hidden
  // native select (the :has() stylesheet rule targets this wrapper).
  const method = methodSelect?.closest(".foliplus-dropdown-native-host");
  const classes = classesSelect?.closest(".foliplus-dropdown-native-host");
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
  return {
    ok: !!(method && classes && controlCell && secondaryWidth),
    methodGeom,
    classesGeom,
    controlGeom,
    secondaryWidth,
    // The Method dropdown starts at the control cell's left edge.
    methodFillsControl: !!(
      methodGeom &&
      controlGeom &&
      methodGeom.left === controlGeom.left
    ),
    // The class-count dropdown is exactly the compact secondary width.
    classesAtSecondary: !!(
      classesGeom &&
      secondaryWidth &&
      classesGeom.width === secondaryWidth
    ),
    // The two controls do not overlap: the method's right edge is at or
    // before the class count's left edge.
    noOverlap: !!(methodGeom && classesGeom && methodGeom.right <= classesGeom.left),
  };
};
