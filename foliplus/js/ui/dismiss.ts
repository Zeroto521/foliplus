// ui/dismiss — outside press + Escape + focus return, as one primitive.
//
// The same dismissal was re-implemented wherever a floating surface needed
// it: listbox's `ownDismiss` branch and the icon grid's glyph popup (which
// got it wrong twice — `once: true` consumes the listener on the first
// press anywhere, and `addEventListener("remove", …)` never runs because
// remove is not a real event). This is the one implementation; the engine
// and every popup bind it and pair the unbind.
//
// Contract: `onClose` is called once, on the first deciding event. The
// pointer press is captured on `document` (capture phase) so the press that
// closes the popup does not first reach the element under it; Escape is
// captured on `escapeTarget` (window by default, which runs before any
// document-capture listener) and returns focus to `trigger`.
type DismissOptions = {
  /** The open surface. A press outside this containment closes the popup. */
  root: HTMLElement;
  /** Called once, on outside press or Escape. */
  onClose: () => void;
  /** Focus returned on Escape. */
  trigger: HTMLElement;
  /** Containment predicate: a press inside returns false (no close).
   *  Default `target => root.contains(target)`. Override when the popup
   *  and its trigger live in different subtrees (a portalled listbox). */
  containment?: (target: Node) => boolean;
  /** Capture the pointer press on document. Default true (capture phase). */
  capture?: boolean;
  /** Where Escape is captured. Window runs before document-capture listeners
   *  (the panel dispatcher), matching the listbox engine's historical rule. */
  escapeTarget?: Window | Document;
  /** Whether Escape returns focus to the trigger. Default true. */
  restoreFocusOnEscape?: boolean;
};

/** Bind outside-press + Escape dismissal. Returns a paired unbind. */
const bindDismiss = (opts: DismissOptions): (() => void) => {
  const { root, onClose, trigger } = opts;
  const capture = opts.capture ?? true;
  const escapeTarget: Window | Document = opts.escapeTarget ?? window;
  const restoreFocus = opts.restoreFocusOnEscape ?? true;
  let done = false;

  const inside = opts.containment ?? ((target: Node): boolean => root.contains(target));

  const finish = (): void => {
    if (done) return;
    done = true;
    onClose();
  };

  // Outside press. Capture phase: the popup closes before the element under
  // the pointer reacts (a press inside `root` is a native interaction and
  // must keep its behaviour).
  const onOutsidePress = (event: Event): void => {
    const target = event.target as Node | null;
    if (!target) return;
    if (inside(target)) return;
    finish();
  };

  // Escape belongs to the popup while it is open. Captured before the panel
  // dispatcher (#783) and stopped there.
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    finish();
    if (restoreFocus) trigger.focus();
  };

  document.addEventListener("pointerdown", onOutsidePress, capture);
  escapeTarget.addEventListener("keydown", onEscape as EventListener, true);

  return () => {
    document.removeEventListener("pointerdown", onOutsidePress, capture);
    escapeTarget.removeEventListener("keydown", onEscape as EventListener, true);
  };
};

export { bindDismiss };
export type { DismissOptions };
