// common/type — shared common-layer type definitions.
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
 * Shared debounce utility. Returns a debounced version of `func` that
 * delays invocation until `delayMs` ms after the last call.
 * The returned function has a `.cancel()` method to clear pending timers.
 */
type Debounced = ((...args: unknown[]) => void) & {
  cancel: () => void;
  flush: () => void;
};

/** Everything drawing a canvas label needs, resolved from the tokens. */
interface CanvasLabelStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  /** Ready for `ctx.font`. Derived from the three fields above so a caller that
   *  measures text for layout uses the very same numbers this draw will. */
  font: string;
  color: string;
  haloColor: string;
  haloWidth: number;
}

export type { CanvasLabelStyle, Debounced, LogFn, Logger };
