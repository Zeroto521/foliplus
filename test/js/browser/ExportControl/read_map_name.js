() => {
  // Extract the map variable name from the script tag that builds the map.
  for (const s of document.querySelectorAll("script")) {
    const m = s.textContent.match(/var\s+(map_\w+)\s*=\s*L\.map\(/);
    if (m) return m[1];
  }
  return "map";
};
