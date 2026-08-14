() => {
  const mm = window.__measureManager;
  mm.layers.mainLayer.eachLayer(sub =>
    sub.eachLayer(l => {
      if (l instanceof L.Marker) {
        const po = l.getPopup && l.getPopup();
        if (po && po.getContent && po.getContent().includes) {
          l.openPopup();
        }
      }
    }),
  );
};
