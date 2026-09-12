// Runtime guard — ensures foliplus runtime is loaded before component init.
// Throws a clear error when runtime is missing, stopping the component early
// rather than letting it fail later at an obscure DOM access.
// (createControlEnv lives in #core/controlEnv.js — it also registers hint icons.)
import { createLogger } from "#common/log.js";

// The prefix is a parameter here (no module-level CONF), so the logger is
// bound inside the function — file-top binding is only possible where the
// name is known at module level.
const requireRuntime = (componentName: string): void => {
  const log = createLogger(componentName);
  if (!window.foliplus) {
    throw new Error(log.msg("foliplus runtime not found, plugin disabled."));
  }
};

export { requireRuntime };
