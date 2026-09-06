// common/log — namespaced foliplus diagnostics.
// Every foliplus console message and thrown error message carries a `[<name>]`
// prefix so output is greppable and attributable at a glance. Components pass
// CONF.name; shared modules that take a caller name (e.g. storage) keep their
// parameterised one.
//
// One shape, two separators — and the caller never chooses:
//   log line  "[LayerControl] dropped stale ids"  — prefix, space, statement
//   thrown    "[LayerRegistry]: cannot delete"    — prefix, colon, stack heading
// A log is a statement; an error message is the stack trace's heading. The
// separator is decided by which side of the logger you call.

/** A logger bound to a fixed `[<name>]` prefix. */
type LogFn = (message: string, ...args: unknown[]) => void;

/**
 * A logger with a fixed namespaced prefix.
 *
 * `warn` / `error` write to the console with `[<name>] `.
 * `msg` returns the message for a `throw new Error(...)` — the colon separator
 * marks it as a stack-trace heading, so it returns a string and never calls
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
 *      → "[MeasureControl]: crop too small"
 */
const createLogger = (name: string): Logger => {
  const namespaced = (message: string, separator: " " | ": "): string =>
    `[${name}]${separator}${message}`;

  return {
    warn: (message, ...args) => console.warn(namespaced(message, " "), ...args),
    error: (message, ...args) => console.error(namespaced(message, " "), ...args),
    msg: message => namespaced(message, ": "),
  };
};

export { createLogger, type LogFn, type Logger };
