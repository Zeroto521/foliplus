// SearchControl/logic/lifecycle — control teardown.
//
// The entry module used to inline the whole teardown list. A list is only as
// complete as the author's memory: the two map layers this control creates (the
// result pin and its ✕) were reclaimed from setMode() and the clear button but
// not here, so removing the control left them floating. Teardown now withdraws
// the request gates first (a late provider response settles inert), then runs the
// named steps over the resources the control actually owns.
import { flushHistory } from "./history.js";
import { releaseOwnedLayers } from "./owned.js";
import { removePanel } from "./panel.js";
import { invalidateRequests } from "./request.js";
import { type SearchControlCtx } from "./util.js";
import type { Debounced } from "#platform/debounce.js";
import { finalize } from "#platform/finalize.js";

/** The control fields teardown touches beyond the logic-level state. */
type DestroyableControl = SearchControlCtx & {
  modeBtn: HTMLElement;
  clearBtn: HTMLElement;
  /** Absent when buildDOM() died before initDebouncedFetch() ran. */
  debouncedFetch?: Debounced;
};

/**
 * Release everything the control owns. Safe on a partially built control, and
 * safe to run twice: every step is isolated so one throwing teardown cannot skip
 * the rest, and the field resets below run even when a step threw.
 */
const destroyControl = (ctrl: DestroyableControl): void => {
  // Retire the gates before anything else: from here on every in-flight read
  // settles inert, so no step below can be undone by a late .then.
  invalidateRequests(ctrl);
  finalize(
    [
      ["remove-panel", () => removePanel(ctrl)],
      ["cancel-fetch", () => ctrl.debouncedFetch?.cancel()],
      ["abort-suggest", () => ctrl.suggestAbortController?.abort()],
      ["release-layers", () => releaseOwnedLayers(ctrl)],
      ["flush-history", () => flushHistory(ctrl)],
      ["release-timers", () => ctrl.timers.dispose()],
      ["detach-mode-btn", () => (ctrl.modeBtn.onclick = null)],
      ["detach-clear-btn", () => (ctrl.clearBtn.onclick = null)],
    ],
    failure => ctrl.log.warn(`destroy step "${failure.name}" threw`, failure.error),
  );
  // Resets, not steps: the state must be dropped even when a step threw.
  ctrl.marker = null;
  ctrl.delIcon = null;
  ctrl.cachedSuggestions?.clear();
  ctrl.searchHistory = [];
};

export { destroyControl };
