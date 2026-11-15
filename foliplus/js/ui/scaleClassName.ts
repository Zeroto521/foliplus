// ui/scaleClassName — shared panel vocabulary for the scale control shell.
//
// `foliplus-scale-wrap` is written by ScaleControl (the control shell class)
// and read by FullscreenControl (which hides every sibling scale wrap while a
// fullscreen session is active). It is the only token of the scale shell that
// crosses a control boundary, so it lives here rather than in ScaleControl's
const SCALE_CLASS = {
  /** The scale control's shell (the `.leaflet-control` wrapper). */
  WRAP: "foliplus-scale-wrap",
} as const;

export { SCALE_CLASS };
