// ui/panelReset — the shared outcome of a panel-wide Reset/Clear.
/**
 * A panel-wide Reset/Clear restores values; it does not dismiss the panel.
 * The decision lives here, not at the call sites: a surface says only what
 * "close" means for it and which button keeps focus, so the style panel's
 * Reset, the filter panel's Clear and the heatmap panel's Clear cannot drift.
 *
 * The policy is bound once. The factory exists so the two outcomes stay
 * testable without letting a caller choose one.
 */
/**
 * The focus target: the Reset/Clear button, or a resolver when the reset hides
 * or disables that button and focus has to fall to the next visible control.
 */
import { createLogger } from "#platform/log.js";

type PanelResetFocus = HTMLElement | (() => HTMLElement | null);

/** The shared diagnostic channel: a step failure is never silent, even for a
 *  caller that forgot its own hook. */
const log = createLogger("panelReset");

/** One restore step. A surface declares its dimensions as steps instead of one
 *  opaque closure so a single broken dimension cannot take the rest down with
 *  it: the style panel restores eight independent faces, and one throwing leaf
 *  must not leave the layer half-reset (the exact "Reset did nothing" symptom,
 *  where the dimensions before the throw landed and everything after it —
 *  including the refresh that repaints the panel — never ran). */
type PanelResetStep = () => void;

interface PanelResetOutcome {
  /** Restore steps, run in order. A function is a single step. */
  restore: PanelResetStep | readonly PanelResetStep[];
  /** The close path this surface would run if a reset dismissed the panel. */
  close: () => void;
  /** Re-sync the open panel's controls with the restored values. */
  refresh?: () => void;
  /** Where focus lands when the panel stays open. */
  focus?: PanelResetFocus;
  /** Called once per failed step, so the surface can log the dimension. */
  onError?: (error: unknown, step: number) => void;
}

/** Run every restore step even when one throws. The failures are returned for
 *  the caller's diagnostic hook; a failed dimension never aborts the reset. */
const runResetSteps = (
  steps: readonly PanelResetStep[],
  onError: (error: unknown, step: number) => void = (error, step) =>
    log.warn(`reset step ${step} failed — the remaining steps still ran`, error),
): unknown[] => {
  const failures: unknown[] = [];
  steps.forEach((step, index) => {
    try {
      step();
    } catch (error) {
      failures.push(error);
      onError?.(error, index);
    }
  });
  return failures;
};

const createPanelResetOutcome =
  (dismisses: boolean) =>
  ({ restore, close, refresh, focus, onError }: PanelResetOutcome): void => {
    const steps = typeof restore === "function" ? [restore] : restore;
    // Run the restore as isolated steps: a broken dimension is logged and the
    // remaining ones still land, so the refresh below always repaints from a
    // state as close to the defaults as the surface could get.
    runResetSteps(steps, onError);
    if (dismisses) {
      close();
      return;
    }
    refresh?.();
    const target = typeof focus === "function" ? focus() : focus;
    // The panel did not move; focusing the rebuilt button must not scroll it
    // (or the layer list) into view.
    target?.focus({ preventScroll: true });
  };

/** A reset restores values; it does not dismiss the panel. */
const finishPanelReset = createPanelResetOutcome(false);

/** The focusable controls a reset may hand focus to when its own trigger is
 *  hidden or disabled. A disabled button cannot take focus (the browser drops
 *  the call), so every reset surface resolves this fallback instead of
 *  focusing a dead target and leaving focus on `<body>`.
 *
 *  Document order is the contract: the first usable control is the one a
 *  keyboard user reaches with the next Tab press. */
const PANEL_FOCUSABLE = [
  "button:not(:disabled)",
  "select:not(:disabled)",
  "input:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

const firstUsableControl = (root: ParentNode): HTMLElement | null =>
  root.querySelector<HTMLElement>(PANEL_FOCUSABLE);

/** Paint a panel-wide Reset/Clear trigger from its live state.
 *
 *  The native `disabled` attribute is the behaviour (no press, no focus, out
 *  of the Tab order); `aria-disabled` mirrors it for assistive tech, and the
 *  tooltip explains the disabled state instead of leaving a mute button. One
 *  helper keeps the style panel's Reset and the filter panel's Clear on the
 *  same contract — the two must not drift on "what a disabled action looks
 *  like". */
interface PanelActionState {
  disabled: boolean;
  /** Tooltip while the action can run. */
  enabledTitle: string;
  /** Tooltip while it cannot (nothing to restore / clear). */
  disabledTitle: string;
}

const syncPanelAction = (
  button: HTMLButtonElement,
  { disabled, enabledTitle, disabledTitle }: PanelActionState,
): void => {
  const title = disabled ? disabledTitle : enabledTitle;
  const aria = disabled ? "true" : "false";
  // A live drag can publish one style change per frame; the DOM writes are
  // cheap but a no-op guard keeps title/aria churn out of the busy path.
  if (
    button.disabled === disabled &&
    button.getAttribute("aria-disabled") === aria &&
    button.title === title
  ) {
    return;
  }
  button.disabled = disabled;
  button.setAttribute("aria-disabled", aria);
  button.title = title;
};

export {
  createPanelResetOutcome,
  finishPanelReset,
  firstUsableControl,
  runResetSteps,
  syncPanelAction,
};
