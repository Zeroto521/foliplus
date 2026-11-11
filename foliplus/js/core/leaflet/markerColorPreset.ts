// core/leaflet — the awesome-markers preset chassis palette.
//
// The 19 preset hex center-samples (PIL-decoded from the markers-soft.png
// sprite). Two directions are needed:
//   • name → hex — the row's author default (a preset name maps forward to its
//     hex for the swatch);
//   • hex → name — the paint path (a user hex that is exactly one of the 19
//     presets keeps the library's sprite class, pixel-identical to #1033; a
//     non-preset hex takes the flat mask).
// Kept in core/leaflet (same cluster as markerIcon.ts) so the reverse lookup
// does not import the layer barrel and close the LayerFactory ↔ leaflet cycle.
const MARKER_COLOR_PRESET_HEX: Readonly<Record<string, string>> = {
  red: "#d63e2a",
  darkred: "#a23336",
  lightred: "#ff8e7f",
  orange: "#f69730",
  beige: "#ffcb92",
  green: "#72b026",
  darkgreen: "#728224",
  lightgreen: "#bbf970",
  blue: "#38aadd",
  darkblue: "#0067a3",
  lightblue: "#8adaff",
  purple: "#d252b9",
  darkpurple: "#5b396b",
  pink: "#ff91ea",
  cadetblue: "#436978",
  white: "#fbfbfb",
  gray: "#575757",
  lightgray: "#a3a3a3",
  black: "#303030",
};

/** Reverse lookup: the preset name for a hex, or null when the hex is not one
 *  of the 19 presets. */
const presetNameOfHex = (hex: string): string | null => {
  const needle = hex.toLowerCase();
  for (const [name, value] of Object.entries(MARKER_COLOR_PRESET_HEX)) {
    if (value === needle) return name;
  }
  return null;
};

export { MARKER_COLOR_PRESET_HEX, presetNameOfHex };
