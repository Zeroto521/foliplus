// Sets opacity 0.4 on layer A and reads the effective computed opacity for
// both A and B — B must be at the browser default. Returns the pair and
// resets A afterwards.
([idA, idB]) => {
  const m = window.__layerCtrl.mgr;
  const a = m.findLayer(m.layers.find(l => l.id === idA));
  const b = m.findLayer(m.layers.find(l => l.id === idB));
  a.setOpacity(0.4);
  const effA = getComputedStyle(a._container).opacity;
  const effB = getComputedStyle(b._container).opacity;
  a.setOpacity(1);
  return { effA, effB };
};
