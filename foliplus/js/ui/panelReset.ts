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
type PanelResetFocus = HTMLElement | (() => HTMLElement | null);

interface PanelResetOutcome {
  /** Restore this surface's values to their defaults. */
  restore: () => void;
  /** The close path this surface would run if a reset dismissed the panel. */
  close: () => void;
  /** Re-sync the open panel's controls with the restored values. */
  refresh?: () => void;
  /** Where focus lands when the panel stays open. */
  focus?: PanelResetFocus;
}

const createPanelResetOutcome =
  (dismisses: boolean) =>
  ({ restore, close, refresh, focus }: PanelResetOutcome): void => {
    restore();
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

export { createPanelResetOutcome, finishPanelReset };
