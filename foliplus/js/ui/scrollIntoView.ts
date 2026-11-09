// ui/scrollIntoView — the one primitive that keeps the active row visible.
/** ensureActiveVisible — scroll the active row into view within its scroll
 *  container (the "block: nearest" semantics shared by the roving listbox and
 *  the list cursor).
 *
 *  Single source of the visibility guarantee: a list host must not re-derive
 *  its own scroll math. Roving (listbox) and active-descendant (list cursor)
 *  both call this so "what keeps the active row visible" never diverges.
 */
const ensureActiveVisible = (el: HTMLElement | null): void => {
  el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
};

export { ensureActiveVisible };
