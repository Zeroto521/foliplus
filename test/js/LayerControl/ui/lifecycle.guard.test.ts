import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(".");
const LIFECYCLE = resolve(ROOT, "foliplus/js/LayerControl/ui/lifecycle.ts");

// ── Static guard: every replay is queued before the notify ────────
//
// `onLayerItemCountChange` is the hook three dimensions have had to claim
// in sequence — #727 fill, #723 event settling, #726 size — and each one
// was a three-way merge by hand. The rule that keeps it correct is an
// ORDERING rule, not a type rule, so TypeScript cannot catch a breach:
// every dimension replay has to be queued before `notifyDelta` publishes,
// because the notify is the step that can still go wrong.
//
// Two failure modes, both silent:
//
//   - A projection consumer throws. Everything after the notify is skipped,
//     so a replay queued below it never runs: the map keeps the authored
//     values while the panel shows the chosen one.
//
//   - A consumer unregisters the layer reentrantly. The LAYER_ITEM_REMOVED
//     teardown has already dropped the queued tasks, so a replay scheduled
//     after that point creates a task for an id that is already gone.
//
// Neither fails a build. This scan is what pins the order. It is anchored
// on the full call text rather than on a bare name, so a comment that
// mentions the step cannot satisfy it.

// CRLF-tolerant: the checkout may carry Windows endings, and a stray `\r`
// would make the closing-brace comparison miss its own line.
const LINES = readFileSync(LIFECYCLE, "utf8").split(/\r?\n/);

/** The lines of one top-level arrow function, by its declaration name. */
const bodyLines = (decl: string): string[] => {
  const start = LINES.findIndex(l => l.startsWith(`const ${decl} = (`));
  expect(start, `${decl} not found`).toBeGreaterThan(-1);
  const end = LINES.slice(start).findIndex(l => l === "};");
  expect(end, `${decl} has no closing brace`).toBeGreaterThan(-1);
  return LINES.slice(start, start + end);
};

/** The 0-based lines inside `body` that mention `needle`. */
const at = (body: string[], needle: string) =>
  body.map((line, i) => (line.includes(needle) ? i : -1)).filter(i => i >= 0);

// The steps that must finish before the notify publishes. applyProjection
// first because its return value is the delta the notify carries; the style
// replays because they are what a newly-landed leaf still needs. The two
// scheduler needles are face-scoped: each replayed face is pinned on its
// own, not just the presence of some scheduler call.
const BEFORE_NOTIFY = [
  "applyProjection(",
  "replaySizeIntent(",
  "scheduleStyleDimApply(FACE.FILL",
  "scheduleStyleDimApply(FACE.STROKE",
];

describe("onLayerItemCountChange — replay ordering", () => {
  const body = bodyLines("onLayerItemCountChange");

  it("the notify is the last step of the operation", () => {
    const notify = at(body, "notifyDelta(");
    expect(notify, "the operation must publish").toHaveLength(1);
    for (const step of BEFORE_NOTIFY) {
      const steps = at(body, step);
      expect(steps, `${step} must be reached`).toHaveLength(1);
      expect(steps[0], `${step} must precede the notify`).toBeLessThan(notify[0]);
    }
  });
});
