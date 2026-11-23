// Tests for the shared select-all tri-state helper (ui/selectAllState.ts).
import { describe, expect, it } from "vitest";
import {
  type SelectAllVerdict,
  selectAllAction,
  selectAllStateOf,
} from "#ui/selectAllState.js";

describe("selectAllStateOf — the shared tri-state verdict", () => {
  it("is none when nothing is selected", () => {
    const v: SelectAllVerdict = selectAllStateOf(4, 0);
    expect(v.state).toBe("none");
    expect(v.allChecked).toBe(false);
    expect(v.noneChecked).toBe(true);
  });

  it("is indeterminate for a partial selection", () => {
    const v = selectAllStateOf(4, 2);
    expect(v.state).toBe("indeterminate");
    expect(v.allChecked).toBe(false);
    expect(v.noneChecked).toBe(false);
  });

  it("is all when every item is selected", () => {
    const v = selectAllStateOf(4, 4);
    expect(v.state).toBe("all");
    expect(v.allChecked).toBe(true);
    expect(v.noneChecked).toBe(false);
  });

  it("treats an empty set as none, never indeterminate", () => {
    // An empty layer type or an option list that has not populated is the
    // trap: 0 === 0 looks like "all selected", which would read the box as
    // checked on a list with nothing to select.
    const v = selectAllStateOf(0, 0);
    expect(v.state).toBe("none");
    expect(v.allChecked).toBe(false);
  });

  it("keeps the box empty rather than all when selection exceeds total", () => {
    // Defensive: a caller that over-counts must not read as "all".
    expect(selectAllStateOf(3, 5).state).toBe("indeterminate");
  });
});

describe("selectAllAction — what pressing the box does", () => {
  it("clears when everything is already picked", () => {
    expect(selectAllAction("all")).toBe("clear");
  });

  it("selects all from none and from indeterminate", () => {
    expect(selectAllAction("none")).toBe("select-all");
    expect(selectAllAction("indeterminate")).toBe("select-all");
  });
});
