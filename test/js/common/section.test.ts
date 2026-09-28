import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { createSection } from "#common/section.js";

// Resolved against cwd — the repo root every build script assumes.
const ROOT = resolve(".");

// Pull one block out of a stylesheet, brace-matched so a nested `&` rule
// inside the block is not cut off at its first `}`.
const ruleBlock = (src: string, selector: string): string => {
  const start = src.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed rule: ${selector}`);
};

// First declaration of `prop` inside a block, value only.
const decl = (block: string, prop: string): string => {
  const m = block.match(new RegExp(`(?:^|[^-\\w])${prop}:\\s*([^;]+);`));
  if (!m) throw new Error(`no ${prop} declaration`);
  return m[1].trim();
};

// Spacing values are one indirection deep (`--space-lg` → `--size-12` →
// `12px`), so chase the var() chain until a literal lands.
const px = (tokens: string, value: string): number => {
  let v = value.trim();
  for (let i = 0; i < 4; i += 1) {
    const ref = v.match(/^var\((--[\w-]+)\)$/);
    if (!ref) break;
    v = decl(tokens, ref[1]).trim();
  }
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`${value} did not resolve to px: ${v}`);
  return n;
};

describe("createSection — DOM shape", () => {
  it("wraps a title button and empty body in .foliplus-section", () => {
    const s = createSection({ title: "Layer" });

    expect(s.root.tagName).toBe("SECTION");
    expect(s.root.className).toBe("foliplus-section");
    expect(s.root.children).toHaveLength(2);

    expect(s.head.className).toBe("foliplus-section-heading");
    expect(s.body.className).toBe("foliplus-section-body");

    expect(s.titleEl.tagName).toBe("BUTTON");
    expect(s.titleEl.getAttribute("type")).toBe("button");
    expect(s.titleEl.textContent).toBe("Layer");
    expect(s.head.textContent).toBe("Layer");
  });

  it("renders exactly one child in the head when the caller passes no switch", () => {
    const s = createSection({ title: "Label" });

    expect(s.switchEl).toBeNull();
    expect(s.head.children).toHaveLength(1);
    expect(s.head.textContent).toBe("Label");
  });

  it("mounts the caller's switch element into the head's right slot", () => {
    const sw = document.createElement("label");
    sw.className = "foliplus-toggle-switch";
    const s = createSection({ title: "Label", switch: sw });

    expect(s.switchEl).toBe(sw);
    expect(s.head.contains(sw)).toBe(true);
    expect(s.head.lastElementChild).toBe(sw);
  });

  it("accepts an element title and does not double-encode it", () => {
    const titleEl = document.createElement("span");
    titleEl.textContent = "Title via element";
    const s = createSection({ title: titleEl });

    expect(s.titleEl.contains(titleEl)).toBe(true);
    expect(s.titleEl.textContent).toBe("Title via element");
  });

  it("removes the title from tab order when the section is not collapsible", () => {
    const s = createSection({ title: "Static" });
    expect(s.titleEl.getAttribute("tabindex")).toBe("-1");
  });

  it("keeps the title in tab order when the section is collapsible", () => {
    const s = createSection({ title: "Group", collapsible: true });
    expect(s.titleEl.getAttribute("tabindex")).toBe("0");
  });
});

describe("createSection — collapsible", () => {
  it("does not set aria-expanded and does not toggle on click by default", () => {
    const s = createSection({ title: "Static" });

    expect(s.titleEl.getAttribute("aria-expanded")).toBeNull();
    s.head.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(s.root.classList.contains("foliplus-is-collapsed")).toBe(false);
  });

  it("toggles is-collapsed on head click when collapsible", () => {
    const s = createSection({ title: "Group", collapsible: true });

    expect(s.titleEl.getAttribute("aria-expanded")).toBe("true");
    expect(s.root.classList.contains("foliplus-is-collapsed")).toBe(false);

    s.head.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(s.root.classList.contains("foliplus-is-collapsed")).toBe(true);
    expect(s.titleEl.getAttribute("aria-expanded")).toBe("false");

    s.head.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(s.root.classList.contains("foliplus-is-collapsed")).toBe(false);
    expect(s.titleEl.getAttribute("aria-expanded")).toBe("true");
  });

  it("starts collapsed when `collapsed` is set, aria-expanded reflects it", () => {
    const s = createSection({ title: "Hidden", collapsible: true, collapsed: true });

    expect(s.root.classList.contains("foliplus-is-collapsed")).toBe(true);
    expect(s.titleEl.getAttribute("aria-expanded")).toBe("false");
  });

  it("collapses from the title button as well as the head row", () => {
    const s = createSection({ title: "Group", collapsible: true });

    s.titleEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(s.root.classList.contains("foliplus-is-collapsed")).toBe(true);
    expect(s.titleEl.getAttribute("aria-expanded")).toBe("false");
  });

  it("swallows clicks that started inside the switch, so the switch owns its state", () => {
    const sw = document.createElement("input");
    sw.type = "checkbox";
    const s = createSection({ title: "With switch", collapsible: true, switch: sw });

    sw.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(s.root.classList.contains("foliplus-is-collapsed")).toBe(false);
  });
});

describe("createSection — programmatic API", () => {
  it("setCollapsed(true/false) toggles the class and aria-expanded", () => {
    const s = createSection({ title: "T", collapsible: true });

    s.setCollapsed(true);
    expect(s.root.classList.contains("foliplus-is-collapsed")).toBe(true);
    expect(s.titleEl.getAttribute("aria-expanded")).toBe("false");

    s.setCollapsed(false);
    expect(s.root.classList.contains("foliplus-is-collapsed")).toBe(false);
    expect(s.titleEl.getAttribute("aria-expanded")).toBe("true");
  });

  it("setCollapsed is a no-op on a non-collapsible section", () => {
    const s = createSection({ title: "Static" });

    s.setCollapsed(true);
    expect(s.root.classList.contains("foliplus-is-collapsed")).toBe(false);
    expect(s.titleEl.getAttribute("aria-expanded")).toBeNull();
  });

  it("setSwitch(true) checks a raw input switch", () => {
    const sw = document.createElement("input");
    sw.type = "checkbox";
    const s = createSection({ title: "T", switch: sw });

    expect(sw.checked).toBe(false);
    s.setSwitch(true);
    expect(sw.checked).toBe(true);
  });

  it("setSwitch(true) checks an input nested inside a wrapper switch", () => {
    const sw = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    sw.appendChild(input);

    const s = createSection({ title: "T", switch: sw });
    s.setSwitch(true);
    expect(input.checked).toBe(true);
  });

  it("setSwitch is a no-op when no switch was provided", () => {
    const s = createSection({ title: "No switch" });
    expect(() => s.setSwitch(true)).not.toThrow();
  });
});

// The group header's whole job is to sit between the panel title and the rows
// without reading as either. jsdom never resolves custom properties, so the
// declarations that carry that hierarchy are read from the stylesheet source
// rather than from getComputedStyle.
describe("createSection — group header styling", () => {
  const form = readFileSync(resolve(ROOT, "foliplus/css/common/form.css"), "utf8");
  const section = readFileSync(
    resolve(ROOT, "foliplus/css/common/section.css"),
    "utf8",
  );
  const tokens = readFileSync(resolve(ROOT, "foliplus/css/common/token.css"), "utf8");

  it("sits one notch under the row label it introduces", () => {
    const heading = ruleBlock(form, ".foliplus-section-heading");
    const label = ruleBlock(form, ".foliplus-form-label");

    // 11px against the row label's 12px: smaller than what it labels, so the
    // eye lands on the row rather than on the group name.
    expect(decl(heading, "font-size")).toBe("11px");
    expect(px(tokens, decl(label, "font-size"))).toBe(12);
    expect(px(tokens, decl(heading, "font-size"))).toBeLessThan(12);
  });

  it("reads muted and tracked so it does not compete with a row", () => {
    const heading = ruleBlock(form, ".foliplus-section-heading");
    const label = ruleBlock(form, ".foliplus-form-label");

    // The rows keep full-strength ink; the contrast is what separates a
    // group name from a fact.
    expect(decl(heading, "color")).toBe("var(--text-muted)");
    expect(decl(label, "color")).toBe("var(--text-primary)");
    expect(decl(heading, "letter-spacing")).toBe("1.5px");
    // The row keeps default tracking — only the group name is set apart.
    expect(ruleBlock(form, ".foliplus-form-label")).not.toContain("letter-spacing");
  });

  it("spends more vertical whitespace than the gap between rows", () => {
    const heading = ruleBlock(form, ".foliplus-section-heading");
    const padding = decl(heading, "padding").split(/\s+/);
    expect(padding).toHaveLength(3);

    const top = px(tokens, padding[0]);
    const bottom = px(tokens, padding[2]);
    // Rows inside a group sit --space-xs apart; the group edge outranks it.
    expect(top).toBeGreaterThan(px(tokens, "var(--space-xs)"));
    expect(bottom).toBeGreaterThan(px(tokens, "var(--space-xs)"));
  });

  it("keeps the switch on the right of the title in the shared grid", () => {
    const head = ruleBlock(section, ".foliplus-section-heading");
    expect(decl(head, "display")).toBe("grid");
    expect(decl(head, "grid-template-columns")).toBe("1fr auto");
  });

  it("declares no caption slot anywhere in the section styles", () => {
    expect(section).not.toContain(".foliplus-section-caption");
    expect(form).not.toContain("foliplus-section-caption");
  });
});
