// Find the marker's variable name (folium names it `marker_<hash>`) so we
// can pass it to the set_test_marker helper. Returns null when no marker
// is on the page.
() => {
  const s = Array.from(document.scripts)
    .map(n => n.textContent)
    .join("\n");
  const m = s.match(/var (marker_[a-f0-9]+) = L\.marker/);
  return m ? m[1] : null;
};
