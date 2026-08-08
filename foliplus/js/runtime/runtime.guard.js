// Runtime guard — ensures foliplus runtime is loaded before component init.
// Returns `true` if runtime is available, `false` otherwise (caller should
// `return` early in that case).
export const requireRuntime = (componentName) => {
  const foliplus = window.foliplus || {};
  if (!foliplus || !foliplus.SVGs) {
    console.error(`[${componentName}] foliplus runtime not found, plugin disabled.`);
    return false;
  }
  return true;
};
