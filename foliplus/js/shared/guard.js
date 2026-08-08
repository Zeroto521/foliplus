// Runtime guard — ensures foliplus runtime is loaded before component init.
// Throws a clear error when runtime is missing, stopping the component early
// rather than letting it fail later at an obscure DOM access.
export const requireRuntime = (componentName) => {
  const foliplus = window.foliplus || {};
  if (!foliplus || !foliplus.SVGs) {
    throw new Error(`[${componentName}] foliplus runtime not found, plugin disabled.`);
  }
};
