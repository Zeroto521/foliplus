// control/LayerControl/declared — barrel: the declared readers behind one import.
//
// The declarations LayerControl reads off a layer (fill, filter, icon / marker
// face, icon size, marker colour, border, opacity) live one module per dimension
// in this directory. Callers import from this barrel — a deep import would let a
// module depend on the parse that happens to serve it rather than on the
// channel's public read, and a later split would break every deep path. The
// read/cache/warn-once skeleton (./key) and the shared declared-string trim
// (./trim) stay internal: they are implementation, not channel facts.

export {
  readDeclaredIcon,
  readDeclaredIconColorOpacity,
  readDeclaredMarker,
  readDeclaredMarkerColorOpacity,
} from "./face.js";
export type { DeclaredIconFace } from "./face.js";
export { readDeclaredFill } from "./fill.js";
export { readDeclaredFilter } from "./filter.js";
export { DECLARED_KEY } from "./declared-key.js";
export { readDeclaredKey } from "./key.js";
export type { RejectFn } from "./key.js";
export { readDeclaredIconSize, readDeclaredMarkerColor } from "./marker.js";
export { readDeclaredBorder, readDeclaredOpacity } from "./parse.js";
