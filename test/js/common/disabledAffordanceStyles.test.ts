// Stylesheet contract for the disabled-entry affordance (task-46).
//
// The disabled affordance is a CSS contract, not a JS behaviour: a disabled
// option must read as "exists but cannot be picked" through the not-allowed
// cursor, and the accent hover that suggests a pickable action must be
// excluded from disabled entries. These assertions guard the selectors so a
// future change cannot silently restore the old arrow cursor or let a
// disabled row answer to hover.
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const cssDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../foliplus/css/common",
);
const read = (name: string): string => readFileSync(resolve(cssDir, name), "utf8");

const dropdownCss = read("dropdown.css");
const schemePickerCss = read("scheme-picker.css");
const menuCss = read("menu.css");

describe("disabled-entry affordance stylesheet contract", () => {
  it("gives a disabled dropdown option a not-allowed cursor", () => {
    expect(dropdownCss).toMatch(
      /\.foliplus-dropdown-option\[disabled\]\s*\{[^}]*cursor:\s*not-allowed/,
    );
  });

  it("gives a disabled scheme-picker item a not-allowed cursor and muted ink", () => {
    expect(schemePickerCss).toMatch(
      /\.foliplus-scheme-picker-item\[aria-disabled="true"\]\s*\{[^}]*cursor:\s*not-allowed/,
    );
    expect(schemePickerCss).toMatch(
      /\.foliplus-scheme-picker-item\[aria-disabled="true"\]\s*\{[^}]*color:\s*var\(--foliplus-text-muted\)/,
    );
  });

  it("excludes disabled scheme-picker items from hover and press", () => {
    expect(schemePickerCss).toMatch(
      /\.foliplus-scheme-picker-item:not\(\[aria-disabled="true"\]\):hover/,
    );
    expect(schemePickerCss).toMatch(
      /\.foliplus-scheme-picker-item:not\(\[aria-disabled="true"\]\):active/,
    );
  });

  it("gives a disabled menu item a not-allowed cursor", () => {
    // The more-menu items are native buttons (task-12), so their disabled
    // state is aria-disabled rather than a bare li[disabled].
    expect(menuCss).toMatch(
      /\.foliplus-layer-more-menu button\[aria-disabled="true"\]\s*\{[^}]*cursor:\s*not-allowed/,
    );
  });

  it("excludes disabled menu items from the shared hover", () => {
    expect(menuCss).toMatch(
      /\.foliplus-layer-more-menu button:not\(\[aria-disabled="true"\]\):hover/,
    );
  });

  it("rejects the pre-fix single-selector hover (negative control)", () => {
    // Before the fix, the scheme-picker hover applied to every item, and the
    // menu hover had no disabled exclusion. If either selector ever returns,
    // the not-allowed affordance is silently lost (a disabled row would answer
    // to hover again). The contract must therefore fail on the OLD shape.
    expect(schemePickerCss).not.toMatch(/\.foliplus-scheme-picker-item:hover\s*\{/);
    expect(schemePickerCss).not.toMatch(
      /\.foliplus-scheme-picker-item:not\(\[disabled\]\):active/,
    );
    expect(menuCss).not.toMatch(
      /:is\(\.foliplus-search-result-item, \.foliplus-layer-more-menu button\):hover/,
    );
    expect(menuCss).not.toMatch(/\.foliplus-layer-more-menu li\[disabled\]/);
  });
});
