// platform/type — shared platform-layer type definitions.
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
  /** Diagnostics below the user's attention — a normal-path no-op worth
   *  knowing about when tracing why a panel did not update. */
  debug: LogFn;
  msg: (message: string) => string;
}

export type { Logger };
