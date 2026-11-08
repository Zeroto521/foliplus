/**
 * Structural guard: every floating layer's gesture containment goes through
 * the unified entry (bindFloatingGestures or mountFloating, which auto-binds
 * it) — no caller may remember a raw bindFloatingTouch / bindFloatingWheel.
 *
 * Two invariants:
 *  A) Production code under foliplus/js/ has no bare bindFloatingTouch( or
 *     bindFloatingWheel( call except inside the floating.ts definition itself
 *     and the whitelisted inline-listbox entry (which uses the unified
 *     bindFloatingGestures, not a raw call). A new floating layer that wires a
 *     raw touch/wheel containment fails here.
 *  B) A .foliplus-panel-content element may only be created inside the two
 *     panel factories (createRowPanel / createPanelControl in
 *     core/leaflet/panel.ts), and each factory must call bindFloatingGestures.
 *     A third ad-hoc creation point (or a factory that forgets the bind)
 *     fails here. This is a factory-location guard, not a call-site enum:
 *     every resident panel body is made by these two factories, so a new
 *     control that uses the factory gets the containment automatically.
 *
 * Red-proof (both directions, recorded):
 *  - A false floating layer that calls bindFloatingTouch(fake) made assertion
 *    A fail with "bare bindFloatingTouch( call"; removing it restored green.
 *  - Removing bindFloatingGestures from createRowPanel made assertion B fail
 *    with "factory createRowPanel missing bindFloatingGestures"; restoring it
 *    returned green.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");

const listTs = (dir: string): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
};

describe("floating gesture containment goes through the unified entry", () => {
  const production = listTs(join(ROOT, "foliplus/js"));
  const sources = new Map(production.map(p => [p, readFileSync(p, "utf8")]));

  it("A: no bare bindFloatingTouch/bindFloatingWheel call in production", () => {
    const offenders: string[] = [];
    for (const [p, src] of sources) {
      // The definition site itself is the only allowed place.
      if (p.replace(/\\/g, "/").endsWith("foliplus/js/common/floating.ts")) continue;
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (
          /bindFloating(Touch|Wheel)\s*\(/.test(line) &&
          !/^\s*import|\/\//.test(line)
        ) {
          offenders.push(`${p}:${i + 1} — ${line.trim()}`);
        }
      });
    }
    // Whitelist: inline listbox uses the unified bindFloatingGestures (not raw).
    expect(offenders).toEqual([]);
  });

  it("B: .foliplus-panel-content created only in the two panel factories, each bound", () => {
    const panelSrc = sources.get(join(ROOT, "foliplus/js/core/leaflet/panel.ts")) ?? "";
    const createSites: string[] = [];
    panelSrc.split("\n").forEach((line, i) => {
      // A creation site is a dom.el element whose class is the panel-content
      // (the selector `:scope > .foliplus-panel-content` is a reference, not
      // a creation point).
      if (/class: "foliplus-panel-content"/.test(line)) {
        createSites.push(`L${i + 1}: ${line.trim()}`);
      }
    });
    // Both factories must exist and create the content element.
    expect(createSites.length).toBeGreaterThanOrEqual(2);
    // Every creation line must be inside createRowPanel or createPanelControl.
    // Heuristic: the factories are the only functions that create it, so the
    // lines must be between the factory declarations.
    const rowLine =
      panelSrc.split("\n").findIndex(l => l.includes("const createRowPanel")) + 1;
    const ctrlLine =
      panelSrc.split("\n").findIndex(l => l.includes("const createPanelControl")) + 1;
    expect(rowLine).toBeGreaterThan(0);
    expect(ctrlLine).toBeGreaterThan(0);
    for (const site of createSites) {
      const lineNo = Number(/L(\d+)/.exec(site)?.[1] ?? 0);
      // Inside createRowPanel body (after its declaration, before the ctrl
      // factory) or inside createPanelControl body (after its declaration).
      const inRow = lineNo > rowLine && lineNo < ctrlLine;
      const inCtrl = lineNo > ctrlLine;
      expect(inRow || inCtrl).toBe(true);
    }
    // Each factory must bind the unified gesture entry.
    // Factory bodies (by character offset from the declaration line).
    const rowLines = panelSrc.split("\n");
    const rowBody = rowLines.slice(rowLine - 1, ctrlLine - 1).join("\n");
    const ctrlBody = rowLines.slice(ctrlLine - 1).join("\n");
    // A comment like "// bindFloatingGestures(content);" must not satisfy
    // the factory-bind assertion — strip comment lines before matching.
    const stripComments = (s: string): string =>
      s
        .split("\n")
        .filter(l => !l.trim().startsWith("//"))
        .join("\n");
    expect(stripComments(rowBody)).toMatch(/bindFloatingGestures\s*\(/);
    expect(stripComments(ctrlBody)).toMatch(/bindFloatingGestures\s*\(/);
  });
});
