// ui/ — panel appearance composition layer.
//
// Single export surface for the panel UI primitives. Consumers and tests
// import from "#ui/index.js" — never from a specific ui module directly —
// so the panel shell owns the namespace shape and a module rename here does
// not ripple through call sites. (JS convention: the directory's index.ts is
// its one export point. The earlier ui-layer-boundary.md §3.2 "no secondary
// re-export" ruling prohibited an alias/re-export layer *beyond* this index,
// not the index itself — see that note for the boundary the barrel keeps.)
export { buttonRow, closeButton, panelButton, sectionDivider } from "./panelChrome.js";
export { readOnlyValue } from "./panelField.js";
