// ExportControl mixed-mode renderer — re-export shim.
// The real implementation lives in ./renderer/ (see renderer/index.ts); this
// file keeps the existing import path (`./renderer.js`) stable for manager.ts
// and the test suite.
export { ExportRenderer, isCorsBlocked, pooledEach } from "./renderer/index.js";
export type { TileLoadStats } from "./renderer/index.js";
