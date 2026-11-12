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

type Debounced = ((...args: unknown[]) => void) & {
  cancel: () => void;
  flush: () => void;
};

interface FinalizeFailure {
  readonly name: string;
  readonly error: unknown;
}

interface FinalizeResult {
  /** Every failure in execution order, paired with its step name. */
  readonly failures: readonly FinalizeFailure[];
  /**
   * Raise the first failure, or return when every step succeeded. Callers that
   * owe a commit (persistence, an announcement) call this AFTER it has landed.
   */
  throwIfFailed(): void;
}

type FinalizeStep = readonly [name: string, run: () => void];

interface Floating {
  /** Re-pin in place (re-run the coordinate algorithm). */
  repin: () => void;
  /** Idempotent teardown: detach listeners, release the portal root. */
  release: () => void;
}

type LocaleTables = Record<string, Record<string, string>>;

type RafLoop = {
  start(key?: string): void;
  stop(): void;
};

type Persisted = {
  /** Queue a write. Immediate when debounceMs is 0, otherwise coalesced. */
  schedule: () => void;
  /**
   * Write any pending state now. No-op when nothing is pending (write-through
   * components, or a caller that has not scheduled since the last write).
   * Idempotent and teardown-safe — the timer is null after flush, so calling
   * flush twice is equivalent to calling it once.
   */
  flush: () => void;
  /** Drop any pending write without writing. */
  cancel: () => void;
};

type PersistedOpts = {
  save: () => boolean;
  debounceMs?: number;
  onFlushError?: (err: unknown) => void;
};

export type {
  Debounced,
  FinalizeFailure,
  FinalizeResult,
  FinalizeStep,
  Floating,
  LocaleTables,
  Logger,
  Persisted,
  PersistedOpts,
  RafLoop,
};
