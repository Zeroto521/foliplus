// Tests for the shared row primitive (ui/rowLayout.ts) and its CSS contract.
//
// jsdom cannot compute flex layout, so the *computed-style parity* between the
// four row surfaces (dropdown option / scheme item / search result / layer
// row) is asserted by the browser probe (test/js/browser/RowLayout/…) and its
// Python driver (test/python/…/test_row_layout.py). This unit suite pins the
// pieces jsdom CAN observe: the DOM shape buildRow() produces, the token
// declarations in token.css and the CSS rule text in row-layout.css.
import { repoPath } from "#test/path.js";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { ROW_CLASS, buildRow } from "#ui/index.js";

const tokenCss = readFileSync(repoPath("foliplus/css/common/token.css"), "utf8");
const rowCss = readFileSync(repoPath("foliplus/css/common/row-layout.css"), "utf8");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("row primitive tokens", () => {
  it("declares the six shared row metrics in token.css", () => {
    const tokens = [
      "--foliplus-row-height: 30px",
      "--foliplus-row-pad-x: 7px",
      "--foliplus-row-leading-width: var(--foliplus-space-xl)",
      "--foliplus-row-gap: 3px",
      "--foliplus-font-size-md: 14px",
      "--foliplus-border-thick: var(--foliplus-size-2)",
    ];
    for (const t of tokens) {
      expect(tokenCss, t).toContain(t);
    }
  });

  it("keeps font-size-md at 14px and border-thick at 2px (the row primitive spellings)", () => {
    // These two already existed; the row primitive reuses them rather than
    // redeclaring, so a drift here would silently change every row surface.
    expect(tokenCss).toMatch(/--foliplus-font-size-md:\s*14px/);
    expect(tokenCss).toMatch(/--foliplus-border-thick:\s*var\(--foliplus-size-2\)/);
  });
});

describe("row primitive css", () => {
  it("pins the .foliplus-row flex box", () => {
    expect(rowCss).toMatch(/\.foliplus-row\s*\{[^}]*display:\s*flex/);
    expect(rowCss).toMatch(
      /\.foliplus-row\s*\{[^}]*min-height:\s*var\(--foliplus-row-height\)/,
    );
    expect(rowCss).toMatch(
      /\.foliplus-row\s*\{[^}]*border-left:\s*var\(--foliplus-border-thick\)\s+solid\s+transparent/,
    );
    expect(rowCss).toMatch(
      /\.foliplus-row\s*\{[^}]*font-size:\s*var\(--foliplus-font-size-md\)/,
    );
  });

  it("pins the three cell slots", () => {
    expect(rowCss).toMatch(
      /\.foliplus-row-leading\s*\{[^}]*flex:\s*0 0 var\(--foliplus-row-leading-width\)/,
    );
    expect(rowCss).toMatch(/\.foliplus-row-content\s*\{[^}]*flex:\s*1 1 auto/);
    expect(rowCss).toMatch(/\.foliplus-row-content\s*\{[^}]*min-width:\s*0/);
    expect(rowCss).toMatch(/\.foliplus-row-trailing\s*\{[^}]*flex:\s*0 0 auto/);
  });
});

describe("buildRow DOM shape", () => {
  it("builds [leading][content][trailing] with the primitive classes", () => {
    const row = buildRow({ leading: "✓", content: "Alpha", trailing: "3" });
    expect(row.classList.contains(ROW_CLASS.ROW)).toBe(true);
    const cells = Array.from(row.children);
    expect(cells.length).toBe(3);
    expect(cells[0].classList.contains(ROW_CLASS.LEADING)).toBe(true);
    expect(cells[0].textContent).toBe("✓");
    expect(cells[1].classList.contains(ROW_CLASS.CONTENT)).toBe(true);
    expect(cells[1].textContent).toBe("Alpha");
    expect(cells[2].classList.contains(ROW_CLASS.TRAILING)).toBe(true);
    expect(cells[2].textContent).toBe("3");
  });

  it("omits leading and trailing when not given", () => {
    const row = buildRow({ content: "Only" });
    const cells = Array.from(row.children);
    expect(cells.length).toBe(1);
    expect(cells[0].classList.contains(ROW_CLASS.CONTENT)).toBe(true);
  });

  it("accepts an HTMLElement leading cell", () => {
    const box = document.createElement("input");
    box.type = "checkbox";
    const row = buildRow({ leading: box, content: "Checked" });
    const leading = row.querySelector(`.${ROW_CLASS.LEADING}`);
    expect(leading?.querySelector("input")).toBe(box);
  });
});
