// control/LayerControl/ui/scope — the panel's teardown as one named, ordered scope.
import { finalize } from "#platform/finalize.js";
import type { FinalizeFailure, FinalizeResult } from "#platform/type.js";

// A panel teardown is a list of things that must all happen: drop the gesture
// state, release the timers, close the open overlays, detach every listener and
// subscription, flush persistence, release the scheduler. Written as an inline
// body, that list is only as complete as the author's memory — this control's
// teardown had 29 subscriptions and two hand-written exit branches, and a
// missing `off()` was silent: nothing failed, the subscriber simply outlived
// the panel.
//
// A scope makes the list enumerable in one place and runs it through
// #platform/finalize, so the two properties the manual sequence lacked hold by
// construction:
//
//   order      — steps run in registration order, which is the order the
//                teardown contract states (a test pins the names);
//   isolation  — a throwing step never skips the steps behind it, and
//                `dispose` returns the failures instead of losing them.
//
// Scope vs finalize: finalize is the runner and owns the contract above; the
// scope is the registration surface that feeds it — `add` additionally models a
// subscription, so its `off` is idempotent and can be handed to a third party
// that may unsubscribe before the panel is torn down. Do not re-derive the
// runner here; do not inline a second teardown list beside the scope.

/** One subscription step: the name is what a failure is reported against. */
interface ScopeSubscription {
  readonly name: string;
  readonly off: () => void;
}

/** Collects teardown steps in execution order and runs them once. */
interface PanelScope {
  /** True once `dispose` ran; a step registered after that runs immediately. */
  readonly disposed: boolean;
  /**
   * Register one teardown step. Registration order IS execution order.
   * A step registered after `dispose` runs at once — a late registration must
   * not strand the work it was meant to release.
   */
  step(name: string, run: () => void): void;
  /**
   * Register an unsubscribe as its own step and return an idempotent `off`.
   * Calling the returned handle detaches now and drops the queue entry, so the
   * dispose that follows never calls it a second time; a dispose first makes
   * the handle a no-op.
   */
  add(name: string, off: () => void): () => void;
  /** The registered step names in execution order (the order contract). */
  names(): string[];
  /**
   * Run every step once, in order, isolating failures. Idempotent: a second
   * call is a no-op with no failures. Never throws — callers that owe an
   * exception call `throwIfFailed()` on the result.
   */
  dispose(report?: (failure: FinalizeFailure) => void): FinalizeResult;
}

/** Create an empty scope. One scope per teardown owner (a LayerUI). */
const createScope = (): PanelScope => {
  const steps: Array<{ name: string; run: () => void }> = [];
  let disposed = false;
  const scope: PanelScope = {
    get disposed() {
      return disposed;
    },
    step(name, run) {
      if (disposed) {
        run();
        return;
      }
      steps.push({ name, run });
    },
    add(name, off) {
      let live = true;
      const unsubscribe = () => {
        if (!live) return;
        live = false;
        const idx = steps.findIndex(entry => entry.run === wrapped);
        if (idx !== -1) steps.splice(idx, 1);
        off();
      };
      const wrapped = () => {
        if (!live) return;
        live = false;
        off();
      };
      scope.step(name, wrapped);
      return unsubscribe;
    },
    names() {
      return steps.map(entry => entry.name);
    },
    dispose(report) {
      if (disposed) return finalize([]);
      disposed = true;
      const queued = steps.splice(0, steps.length);
      return finalize(
        queued.map(entry => [entry.name, entry.run] as const),
        report,
      );
    },
  };
  return scope;
};

export { createScope };
export type { PanelScope, ScopeSubscription };
