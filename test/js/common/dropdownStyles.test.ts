// Stylesheet contract for the shared select replacement (common/dropdown.ts).
//
// This is the ONLY test that catches the placeholder-ink regression: the
// muted rule must be a COMPOUND class (trigger + placeholder), because the
// trigger also carries .foliplus-form-select whose color rule lands later in
// the merged bundle (same (0,1,0) specificity, later file wins). Reverting
// the selector to a single class must fail here even though every jsdom test
// still passes — computed styles are not computed in jsdom.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../foliplus/css/common/dropdown.css",
  ),
  "utf8",
);

describe("dropdown placeholder ink", () => {
  it("paints the placeholder with a compound selector on the trigger", () => {
    // The selector must be the compound (0,2,0), not the single class (0,1,0):
    // .foliplus-form-select (form.css) declares color on a later file, so a
    // single-class .foliplus-dropdown-placeholder would lose the tie.
    const compound = css.match(
      /\n\s*\.foliplus-dropdown-trigger\.foliplus-dropdown-placeholder\s*\{/,
    );
    expect(compound, "placeholder rule must be a compound class").not.toBeNull();

    const single = css.match(/\n\s*\.foliplus-dropdown-placeholder\s*\{/);
    expect(single, "placeholder rule must not be a bare single class").toBeNull();
  });

  it("keeps the muted token as the placeholder ink", () => {
    const rule = css.match(
      /\n\s*\.foliplus-dropdown-trigger\.foliplus-dropdown-placeholder\s*\{[^}]*\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("var(--foliplus-text-muted)");
  });
});
