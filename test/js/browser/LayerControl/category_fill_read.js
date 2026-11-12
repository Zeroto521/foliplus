// Read the category by-value panel state and the map paint together.
() => {
  const mode = document.querySelector(".foliplus-style-fill-mode-select");
  const field = document.querySelector(".foliplus-style-fill-field-select");
  const method = document.querySelector(".foliplus-style-fill-method-select");
  const classes = document.querySelector(".foliplus-style-fill-classes-select");
  const paths = [...document.querySelectorAll(".leaflet-map-pane path")];
  const fills = [...new Set(paths.map(p => p.getAttribute("fill")))];
  const present = fills.filter(f => f !== null && f !== "");
  return {
    mode: mode ? mode.value : null,
    fieldOptions: field ? [...field.options].map(o => o.text) : null,
    fieldValue: field ? field.value : null,
    hasMethodRow: method !== null,
    hasClassesRow: classes !== null,
    count: paths.length,
    present: present.length,
    fills: present.sort(),
    pathFills: paths.map(p => p.getAttribute("fill")),
  };
};
