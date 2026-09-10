() => {
  // Popup content is an element tree, not a string — a guard that assumes a
  // string (getContent().includes) silently skips every marker.
  const hasContent = c =>
    !!c && (typeof c === "string" ? c.length > 0 : c instanceof Node);
  const mm = window.__measureManager;
  mm.layers.mainLayer.eachLayer(sub =>
    sub.eachLayer(l => {
      if (l instanceof L.Marker) {
        const po = l.getPopup && l.getPopup();
        if (po && po.getContent && hasContent(po.getContent())) {
          l.openPopup();
        }
      }
    }),
  );
};
