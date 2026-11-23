// ui/selectAllState — the ONE tri-state verdict for a select-all control.
//
// A "select all" checkbox appears in two places: the layer list per-type
// toggle-all (ui/listPanel/visibility.ts) and the multiple-mode dropdown
// select-all row (ui/dropdown.ts). Both had hand-rolled the same
// three-way verdict from a (total, selected) pair, and both had to
// remember that an empty selection is "none", not "indeterminate":
//
//     const allChecked = total > 0 && selected === total;
//     const noneChecked = selected === 0;
//     box.indeterminate = !allChecked && !noneChecked;
//
// This module owns that arithmetic once. Both surfaces pass their current
// pair and read back the same verdict, so the two cannot drift into
// disagreeing about when the box is half-full.
//
// Contract: this helper ONLY computes. It never touches a checkbox and
// never builds DOM — the caller owns those. It also never reads locale or
// applies an action; the caller decides what pressing the box does.

/** The tri-state a select-all box is in, from a (total, selected) pair. */
type SelectAllState = "none" | "indeterminate" | "all";

/** One tri-state verdict. `indeterminate` is the box half-fill flag; the
 *  two convenience booleans are what the existing call sites read. */
interface SelectAllVerdict {
  state: SelectAllState;
  /** Every selectable item is selected (and there is at least one). */
  allChecked: boolean;
  /** Nothing is selected — the empty state is "none", never indeterminate. */
  noneChecked: boolean;
}

/** Read the tri-state of a select-all control from its item counts.
 *
 *  `total` may be 0 (an empty layer type, an option list that has not
 *  populated): an empty set is "none", so the box never reads as
 *  half-full on a list that has nothing to select. */
const selectAllStateOf = (total: number, selected: number): SelectAllVerdict => {
  const allChecked = total > 0 && selected === total;
  const noneChecked = selected === 0;
  return {
    state: allChecked ? "all" : noneChecked ? "none" : "indeterminate",
    allChecked,
    noneChecked,
  };
};

/** What pressing a select-all box should do, from its current state.
 *
 *  The box is a toggle over the whole set: when everything is already
 *  picked the only useful move is to clear; otherwise pressing it takes
 *  the selection to the full set. "none" and "indeterminate" both land on
 *  select-all, which is why a separate Clear button is redundant with it. */
const selectAllAction = (state: SelectAllState): "select-all" | "clear" =>
  state === "all" ? "clear" : "select-all";

export { selectAllAction, selectAllStateOf };
export type { SelectAllState, SelectAllVerdict };
