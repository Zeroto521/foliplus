// common/log — namespaced console logging.
// Every foliplus console message shares a `[<name>] ` prefix so output is
// greppable and attributable at a glance. Components pass CONF.name; shared
// modules that take a caller name (e.g. storage) keep their parameterised one.

/** A logger bound to a fixed `[<name>] ` prefix. */
type LogFn = (message: string, ...args: unknown[]) => void;

/** A logger with a fixed namespaced prefix. */
interface Logger {
  warn: LogFn;
  error: LogFn;
}

/**
 * Create a logger that prefixes every message with `[<name>] `.
 * e.g. createLogger("MeasureControl").warn("export failed:", err)
 * → console.warn("[MeasureControl] export failed:", err)
 */
const createLogger = (name: string): Logger => {
  const prefix = `[${name}] `;
  return {
    warn: (message, ...args) => console.warn(prefix + message, ...args),
    error: (message, ...args) => console.error(prefix + message, ...args),
  };
};

export { createLogger, type LogFn, type Logger };
