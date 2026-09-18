// common/log — namespaced foliplus diagnostics.
// Every foliplus console message and thrown error message carries a `[<name>]`
// prefix so output is greppable and attributable at a glance. Components pass
// CONF.name; shared modules that take a caller name (e.g. storage) keep their
// parameterised one.
//
// One separator everywhere — a space after `]`. A log line and a thrown
// message differ only in how they are delivered: one goes to the console, the
// other becomes a stack-trace heading.

/** A logger bound to a fixed `[<name>] ` prefix. */
type LogFn = (message: string, ...args: unknown[]) => void;

/**
 * A logger with a fixed namespaced prefix.
 *
 * `warn` / `error` write to the console with `[<name>] `.
 * `msg` returns the same shape for a `throw new Error(...)` — it never calls
 * console. Call sites keep an explicit `throw new` so the control-flow break
 * stays visible.
 */
interface Logger {
  warn: LogFn;
  error: LogFn;
  msg: (message: string) => string;
}

/**
 * Create a logger bound to a `[<name>]` prefix.
 * e.g. createLogger("MeasureControl").warn("export failed:", err)
 *      → console.warn("[MeasureControl] export failed:", err)
 *      → createLogger("MeasureControl").msg("crop too small")
 *      → "[MeasureControl] crop too small"
 */
const createLogger = (name: string): Logger => {
  const namespaced = (message: string): string => `[${name}] ${message}`;

  return {
    warn: (message, ...args) => console.warn(namespaced(message), ...args),
    error: (message, ...args) => console.error(namespaced(message), ...args),
    msg: namespaced,
  };
};

export { createLogger, type LogFn, type Logger };
