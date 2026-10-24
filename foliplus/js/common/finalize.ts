// common/finalize — run teardown steps so one failure cannot skip the rest.
//
// A teardown is a list of things that must ALL happen: drop the gesture, detach
// from the map, remove the row, unload the annotation. Written as inline
// try/catch those steps are only as complete as the author's memory of them —
// the shape that left one segment unprotected in retireEntry. Naming each step
// makes the list enumerable in review, and makes a failure report against the
// step that broke instead of an index that shifts when steps are added.
//
// Use it for "must continue on failure". Anything that should stop on failure
// (a declaration boundary, a fail-fast chain) must throw directly, and a
// single-flag reset is better served by try/finally.

/** One named teardown step. The name is what a failure is reported against. */
type FinalizeStep = readonly [name: string, run: () => void];

/** What one finalize pass observed. */
interface FinalizeResult {
  /** The first error any step threw, or null when every step succeeded. */
  readonly firstError: unknown;
  /** Every failure in execution order, paired with its step name. */
  readonly failures: ReadonlyArray<{ name: string; error: unknown }>;
}

/**
 * Run every step in the given order, isolating each one: a throwing step never
 * skips the steps behind it. Never throws.
 *
 * The caller decides what the first error means — typically it rethrows it
 * AFTER its own commits (persistence, owed events) have landed.
 */
const finalize = (...steps: FinalizeStep[]): FinalizeResult => {
  const failures: Array<{ name: string; error: unknown }> = [];
  for (const [name, run] of steps) {
    try {
      run();
    } catch (error) {
      failures.push({ name, error });
    }
  }
  return { firstError: failures.length > 0 ? failures[0].error : null, failures };
};

/** For callers that only rethrow: the first error, or null when all succeeded. */
const finalizeFirstError = (...steps: FinalizeStep[]): unknown =>
  finalize(...steps).firstError;

/** One item a `finalizeEach` pass failed on. */
interface FinalizeEachFailure<T> {
  readonly name: string;
  readonly item: T;
  readonly error: unknown;
}

/**
 * Run `fn` over every item, isolating each — the loop counterpart of
 * `finalize`, for passes that must keep going and report which items failed
 * (an ordering pass that cannot price one layer still has to price the rest).
 */
const finalizeEach = <T>(
  items: readonly T[],
  fn: (item: T, index: number) => void,
  nameOf: (item: T) => string,
): ReadonlyArray<FinalizeEachFailure<T>> => {
  const failures: Array<FinalizeEachFailure<T>> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      fn(item, i);
    } catch (error) {
      failures.push({ name: nameOf(item), item, error });
    }
  }
  return failures;
};

export { finalize, finalizeEach, finalizeFirstError };
export type { FinalizeEachFailure, FinalizeResult, FinalizeStep };
