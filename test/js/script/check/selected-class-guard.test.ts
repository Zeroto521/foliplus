// The selected-class spelling guard.
//
// The dropdown (DROPDOWN_CLASS.SELECTED = foliplus-is-selected) and the
// picker/listbox (PANEL_CLASS.ACTIVE = foliplus-is-active) each own one
// "current row" marker. The two names are close but they are different
// vocabulary for different components; a third spelling drifting in (or a
// component reaching for the other's marker) is the smell the #1224 review
// flagged. This guard pins: (1) the two tokens are distinct, (2) the dropdown
// code never paints the picker marker and vice versa, and (3) the ARIA
// selected state rides on the listbox only.
import { repoPath } from "#test/path.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DROPDOWN_CLASS } from "#ui/dropdownClassName.js";
import { PANEL_CLASS } from "#ui/panelClassName.js";

const readSrc = (rel: string): string => readFileSync(repoPath(rel), "utf8");

const DROPDOWN_SRC = "foliplus/js/ui/dropdown.ts";
const LISTBOX_SRC = "foliplus/js/ui/listbox.ts";
const OPTION_ROW_SRC = "foliplus/js/ui/optionRow.ts";
const DROPDOWN_CLS_SRC = "foliplus/js/ui/dropdownClassName.ts";
const PANEL_CLS_SRC = "foliplus/js/ui/panelClassName.ts";

describe("selected-class vocabulary stays split", () => {
  it("owns two distinct selected-row tokens", () => {
    expect(DROPDOWN_CLASS.SELECTED).not.toBe(PANEL_CLASS.ACTIVE);
  });

  it("the dropdown never paints the picker's active marker", () => {
    const src = readSrc(DROPDOWN_SRC) + readSrc(DROPDOWN_CLS_SRC);
    expect(src).not.toContain("PANEL_CLASS.ACTIVE");
  });

  it("the picker/listbox never paints the dropdown's selected marker", () => {
    const src = readSrc(LISTBOX_SRC) + readSrc(OPTION_ROW_SRC) + readSrc(PANEL_CLS_SRC);
    // The class token itself is allowed to appear as a literal in the const map
    // (PANEL_CLS defines foliplus-is-active); the *reference* to the other
    // component's token is what must not appear.
    expect(src).not.toContain("DROPDOWN_CLASS.SELECTED");
  });

  it("aria-selected rides the listbox active row, not the dropdown option", () => {
    const dropdown = readSrc(DROPDOWN_SRC);
    const listbox = readSrc(LISTBOX_SRC);
    expect(listbox).toContain("aria-selected");
    expect(dropdown).not.toContain("aria-selected");
  });
});
