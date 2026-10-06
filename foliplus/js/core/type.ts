// core/type — shared core-layer type definitions.
import type { Logger } from "#common/type.js";

/** Environment handed to `setup` / `createManager` and carried on the
 *  generated control instance (`ctrl.config` / `ctrl.T` / `ctrl._` / `ctrl.log`).
 *  `T` scopes keys by the component name; `_` is the bare lookup that
 *  identity-comparison sites (NAME_LABEL_KEY) need. */
type ControlEnv = {
  config: ComponentConfig;
  T: (key: string) => string;
  _: (key: string) => string;
  log: Logger;
};

export type { ControlEnv };
