/**
 * Structural guard for common/floating: the gesture containment over a
 * floating layer goes through the unified entry (bindFloatingGestures, or
 * mountFloating which auto-binds it) — no caller may remember a raw
 * bindFloatingTouch / bindFloatingWheel.
 *
 * Invariant A: production code under foliplus/js/ has no bare
 * bindFloatingTouch( / bindFloatingWheel( call except inside the
 * floating.ts definition itself. A new floating layer that wires a raw
 * touch/wheel containment fails here.
 *
 * Red-proof (recorded, both directions):
 *  - A false floating layer that called bindFloatingTouch(fake) made this
 *    assertion fail with "bare bindFloatingTouch( call"; removing it restored
 *    green. (Temporary probe foliplus/js/_guard_negative_probe.ts.)
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
    expect(offenders).toEqual([]);
  });
});
