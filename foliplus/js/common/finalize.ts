// common/finalize — run a teardown as a list of named, isolated steps.
//
// A teardown is a list of things that must ALL happen: drop the gesture, detach
// from the map, remove the row, unload the annotation. Written as inline
// try/catch those steps are only as complete as the author's memory of them —
// the shape that left one segment unprotected in retireEntry. Naming each step
// makes the list enumerable in review, and makes a failure report against the
// step that broke instead of an index that shifts when steps are added.
//
// Scope: non-event work. `core/event`'s `SettledOperation` is the event-bus
// counterpart — the same contract ("attempt every queued effect, keep the first
// failure, raise once at the boundary"), but it also resolves each failure by
// the event's declared policy (a notification is logged, a terminal event is
// raised). A teardown uses `finalize`; an event fan-out uses an operation. Do
// not re-derive a third variant.
//
// Control flow: a `finally` block guarantees its step runs on every exit path
// (`return`, `throw`, `break`) and remains the right tool for a single reset.
// `finalize` guarantees the other axis — every step runs even when an earlier
// one throws. For a multi-step body, compose: `finally { finalize([...]) }`.
// Never replace a `finally` with a call at the end of the function.
//
// State convention: put work that can throw in the list, and leave plain field
// resets after the call. A reset whose execution depends on step success
// strands a destroyed owner with half-cleared state.
//
// Resolution: a handle or collection resolved *before* the list can throw and
// skip the entire teardown — the shape that left a half-mounted HeatmapControl
// alive. Resolve it inside a step (or from a snapshot that cannot throw), and
// make the later steps tolerate an unresolvable value. Resolve into the owner's
// own field when it has one: teardown must not add a second container for state
// that already has an owner.

/** One named teardown step. The name is what a failure is reported against. */
type FinalizeStep = readonly [name: string, run: () => void];

/** One step that threw, and what it threw. */
interface FinalizeFailure {
  readonly name: string;
  readonly error: unknown;
}

/** What one `finalize` pass observed. */
interface FinalizeResult {
  /** Every failure in execution order, paired with its step name. */
  readonly failures: readonly FinalizeFailure[];
  /**
   * Raise the first failure, or return when every step succeeded. Callers that
   * owe a commit (persistence, an announcement) call this AFTER it has landed.
   */
  throwIfFailed(): void;
}

/** One item a `finalizeEach` pass failed on. */
interface FinalizeEachFailure<T> extends FinalizeFailure {
  readonly item: T;
}

/** Hand one failure to a reporter without letting a broken reporter stop the
 *  teardown — worse than silence, the same way a throwing `onError` hook must
 *  not stop an event bus. */
const reportSafely = <F>(
  report: ((failure: F) => void) | undefined,
  failure: F,
): void => {
  if (!report) return;
  try {
    report(failure);
  } catch {
    // A broken reporter would stop the teardown — worse than silence.
  }
};

/**
 * Run every step in the given order, isolating each one: a throwing step never
 * skips the steps behind it. Never throws.
 *
 * `report` observes failures as they happen — the usual caller is one `warn`
 * per failure. A throwing reporter is swallowed (see `reportSafely`).
 */
const finalize = (
  steps: readonly FinalizeStep[],
  report?: (failure: FinalizeFailure) => void,
): FinalizeResult => {
  const failures: FinalizeFailure[] = [];
  for (const [name, run] of steps) {
    try {
      run();
    } catch (error) {
      const failure: FinalizeFailure = { name, error };
      failures.push(failure);
      reportSafely(report, failure);
    }
  }
  return {
    failures,
    throwIfFailed: () => {
      const first = failures[0];
      if (first) throw first.error;
    },
  };
};

/** Name one item without letting a throwing namer break the isolation. */
const safeName = <T>(
  nameOf: (item: T, index: number) => string,
  item: T,
  index: number,
): string => {
  try {
    return nameOf(item, index);
  } catch {
    return `#${index}`;
  }
};

/**
 * Run `fn` over every item, isolating each — the loop counterpart of
 * `finalize`, for passes that must keep going and report which items failed
 * (an ordering pass that cannot price one layer still has to price the rest).
 *
 * Two ways to consume the outcome, and one is mandatory: pass `report` when a
 * log line is enough, or read the returned failures when the caller needs the
 * items themselves (the ids it could not price). A discarded return with no
 * reporter is a silently swallowed failure — the missing-report shape that
 * let one handle's `dispose()` fail unnoticed.
 */
const finalizeEach = <T>(
  items: readonly T[],
  fn: (item: T, index: number) => void,
  nameOf: (item: T, index: number) => string,
  report?: (failure: FinalizeEachFailure<T>) => void,
): readonly FinalizeEachFailure<T>[] => {
  const failures: FinalizeEachFailure<T>[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      fn(item, i);
    } catch (error) {
      const failure: FinalizeEachFailure<T> = {
        name: safeName(nameOf, item, i),
        item,
        error,
      };
      failures.push(failure);
      reportSafely(report, failure);
    }
  }
  return failures;
};

export { finalize, finalizeEach };
export type { FinalizeEachFailure, FinalizeFailure, FinalizeResult, FinalizeStep };
