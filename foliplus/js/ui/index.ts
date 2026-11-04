// ui/ — panel appearance composition layer.
//
// Single export surface for the panel UI primitives. Consumers and tests
// import from "#ui/index.js" — never from a specific ui module directly —
// so the panel shell owns the namespace shape and a module rename here does
// not ripple through call sites. The index *is* the directory's export point;
// a re-export layer beyond it (an alias module forwarding another file, or a
// second barrel) is what the layering keeps out.
export { buttonRow, closeButton, panelButton, sectionDivider } from "./panelChrome.js";
export { readOnlyValue } from "./panelField.js";
