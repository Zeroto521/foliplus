// The `d` attribute of the toggle's path — the SVG glyph being shown.
// Test assertions key on the `M8 3H5` (MAXIMIZE) vs `M8 3v3` (MINIMIZE)
// prefixes, so the raw string stays the read.
document.querySelector(".foliplus-fullscreen-toggle path").getAttribute("d");
