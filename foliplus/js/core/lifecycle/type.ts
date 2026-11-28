// core/lifecycle/type — shared core-layer type definitions.
import type { Logger } from "#platform/type.js";

/** Environment handed to `setup` / `createManager` and carried on the
 *  generated control instance (`ctrl.config` / `ctrl.T` / `ctrl._` / `ctrl.log`).
 *  `T` scopes keys by the component name; `_` is the bare lookup that
 *  identity-comparison sites (NAME_LABEL_KEY) need. `C` lets an entry narrow
 *  the flat CONFIG once (see config-schema.ts) and hand the typed config down;
 *  the default keeps the shared layers on the flat contract. */
type ControlEnv<C = ComponentConfig> = {
  config: C;
  T: (key: string) => string;
  _: (key: string) => string;
  log: Logger;
};

export type { ControlEnv };
