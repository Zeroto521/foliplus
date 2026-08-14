() => {
  const main = window.__measureManager.layers.mainLayer;
  return Object.values(main._layers).every(
    sub => !sub._layers || Object.keys(sub._layers).length === 0,
  );
};
