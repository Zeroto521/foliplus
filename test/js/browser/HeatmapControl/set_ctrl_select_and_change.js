([attr, value]) => {
  // Set an exposed select's value and fire change (aggSelect / methodSelect /
  // schemeSelectHidden).
  const el = window.__heatmapCtrl[attr];
  el.value = value;
  el.dispatchEvent(new Event("change"));
};
