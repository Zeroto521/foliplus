import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { bindDismiss } from "#ui/dismiss.js";

// Module-mirrored guard for ui/dismiss.ts — the single outside-press /
// Escape / focus-return primitive. The rule: outside-press dismissal is
// ONE implementation. A second copy (the icon grid's `once: true` +
// `addEventListener("remove")` version) was the root cause of the "outside
// press does not close the glyph popup" defect and is now gone.

const ROOT = resolve(import.meta.dirname, "../../..");
const UI_DIR = resolve(ROOT, "foliplus/js");

const listTs = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) return e.name === "dist" ? [] : listTs(p);
    return /\.ts$/.test(e.name) ? [p] : [];
  });

const rel = (p: string): string => p.slice(UI_DIR.length + 1).replace(/\\/g, "/");
const srcOf = (p: string): string => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
// Strip comments so prose that *describes* a bug pattern (the old icon.ts
// notes) never trips the code assertions.
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

// The one place outside-press is implemented. Everything else must not bind
// a document pointerdown (capture or not) as an outside-press dismisser.
const DISMISS_ALLOW = new Set(["ui/dismiss.ts"]);
// Escape capture is shared with the overlay registry's central dispatcher
// (the registry is a layer-stack key distributor, not a second dismiss copy).
const ESCAPE_ALLOW = new Set(["ui/dismiss.ts", "core/overlay/overlayRegistry.ts"]);

describe("outside-press dismissal is one primitive", () => {
  it("document pointerdown as outside press lives only in ui/dismiss.ts", () => {
    const offenders: string[] = [];
    for (const p of listTs(UI_DIR)) {
      if (DISMISS_ALLOW.has(rel(p))) continue;
      const src = srcOf(p);
      if (/document\.addEventListener\(\s*"pointerdown"\s*,/.test(src)) {
        offenders.push(rel(p));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("escape capture (window/document keydown, capture) lives only in the allow-list", () => {
    const offenders: string[] = [];
    for (const p of listTs(UI_DIR)) {
      if (ESCAPE_ALLOW.has(rel(p))) continue;
      const src = srcOf(p);
      if (
        /(?:window|document)\.addEventListener\(\s*"keydown"\s*,.*,\s*true\)/.test(src)
      ) {
        offenders.push(rel(p));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the dismiss primitive never uses once:true or a synthetic remove event", () => {
    const src = stripComments(srcOf(resolve(UI_DIR, "ui/dismiss.ts")));
    expect(src).not.toMatch(/once:\s*true/);
    expect(src).not.toMatch(/addEventListener\(\s*"remove"/);
  });

  it("no production module binds a synthetic remove event", () => {
    const offenders: string[] = [];
    for (const p of listTs(UI_DIR)) {
      if (/addEventListener\(\s*"remove"/.test(stripComments(srcOf(p)))) {
        offenders.push(rel(p));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the allow-list still names real modules", () => {
    for (const f of [...DISMISS_ALLOW, ...ESCAPE_ALLOW]) {
      expect(fs_exists(resolve(UI_DIR, f)), f).toBe(true);
    }
  });
});

// Tiny helper so the allow-list check stays a real assertion.
const fs_exists = (p: string): boolean => {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
};

// Behavior tests for the primitive itself (the guard above is structural).
describe("bindDismiss behaviour", () => {
  const setup = () => {
    const root = document.createElement("div");
    const trigger = document.createElement("button");
    document.body.appendChild(root);
    document.body.appendChild(trigger);
    return { root, trigger };
  };

  it("outside press on document closes when the target is outside the containment", () => {
    const { root, trigger } = setup();
    const closed = vi.fn();
    const unbind = bindDismiss({ root, trigger, onClose: closed });
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(closed).toHaveBeenCalledTimes(1);
    unbind();
    root.remove();
    trigger.remove();
    outside.remove();
  });

  it("a press inside the containment does not close", () => {
    const { root, trigger } = setup();
    const closed = vi.fn();
    const unbind = bindDismiss({ root, trigger, onClose: closed });
    root.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(closed).not.toHaveBeenCalled();
    unbind();
    root.remove();
    trigger.remove();
  });

  it("Escape closes and returns focus to the trigger", () => {
    const { root, trigger } = setup();
    const closed = vi.fn();
    const unbind = bindDismiss({ root, trigger, onClose: closed });
    trigger.focus();
    document.body.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(closed).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    unbind();
    root.remove();
    trigger.remove();
  });

  it("restoreFocusOnEscape: false keeps focus away from the trigger", () => {
    const { root, trigger } = setup();
    const closed = vi.fn();
    const unbind = bindDismiss({
      root,
      trigger,
      onClose: closed,
      restoreFocusOnEscape: false,
    });
    // Focus a different focusable so activeElement is not the trigger.
    const other = document.createElement("button");
    document.body.appendChild(other);
    other.focus();
    expect(document.activeElement).toBe(other);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(closed).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(other);
    unbind();
    root.remove();
    trigger.remove();
    other.remove();
  });

  it("a custom containment predicate is honoured", () => {
    const { root, trigger } = setup();
    const closed = vi.fn();
    const keep = document.createElement("div");
    document.body.appendChild(keep);
    const unbind = bindDismiss({
      root,
      trigger,
      onClose: closed,
      containment: target => root.contains(target) || keep.contains(target),
    });
    keep.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(closed).not.toHaveBeenCalled();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(closed).toHaveBeenCalledTimes(1);
    unbind();
    root.remove();
    trigger.remove();
    keep.remove();
    outside.remove();
  });

  it("onClose fires once even when both outside press and Escape follow", () => {
    const { root, trigger } = setup();
    const closed = vi.fn();
    const unbind = bindDismiss({ root, trigger, onClose: closed });
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(closed).toHaveBeenCalledTimes(1);
    unbind();
    root.remove();
    trigger.remove();
    outside.remove();
  });

  it("unbind is idempotent and removes the listeners", () => {
    const { root, trigger } = setup();
    const closed = vi.fn();
    const unbind = bindDismiss({ root, trigger, onClose: closed });
    unbind();
    unbind();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(closed).not.toHaveBeenCalled();
    unbind();
    root.remove();
    trigger.remove();
    outside.remove();
  });
});
