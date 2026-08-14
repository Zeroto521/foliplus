() => {
  // Read z-index stacking info for the export mask vs scale/attribution.
  const box = document.querySelector(".foliplus-export-box");
  const scale = document.querySelector(".leaflet-control-scale");
  const attr = document.querySelector(".leaflet-control-attribution");
  const get = el => (el ? getComputedStyle(el) : null);
  const boxParent = box ? box.parentElement : null;
  const boxZ = box ? parseInt(get(box).zIndex, 10) : null;
  const parentZ = boxParent ? get(boxParent).zIndex : null;
  const scaleZ = scale ? parseInt(get(scale).zIndex, 10) : null;
  const attrZ = attr ? parseInt(get(attr).zIndex, 10) : null;
  return {
    boxZ,
    parentZ,
    parentIsContainer: boxParent
      ? boxParent.classList.contains("leaflet-container")
      : false,
    scaleZ,
    attrZ,
  };
};
