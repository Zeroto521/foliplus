() => {
  // Current map zoom ceiling and the attribution entry table's keys.
  return {
    zoom: window.map.getMaxZoom(),
    entries: { ...window.map.attributionControl._attributions },
  };
};
