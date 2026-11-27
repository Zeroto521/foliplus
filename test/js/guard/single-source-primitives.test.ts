// Guard: the three single-source primitives #1407 extracted keep exactly one
// definition and one driftable shape in the production tree.
//
// #1407 (review P3-4) pulled three repeated shapes into one module each:
//   - attachMenuController — control/LayerControl/ui/overlayPanel/menu.ts, the
//     one layer/folder/role menu attach scaffold, keyed localId: "menu".
//   - createPickerHolder — control/LayerControl/ui/style/pickerHolder.ts, the
//     one per-UI scheme-picker slot, a WeakMap<LayerUI, SchemePicker> pair.
//   - createReplayGate — control/LayerControl/ui/style/replay.ts, the one per-UI
//     declared-replay gate, a WeakMap<LayerUI, Set<string>>.
//
// Extraction alone does not stop a later caller from hand-rolling the shape
// again, and the copies drift silently: a menu that skips one dismissal path, a
// picker slot the panel never disposes, a gate that repaints a declared
// dimension twice. TypeScript sees three valid modules and no unit test compares
// them, so this guard reads the real foliplus/js/** tree, counts each driftable
// signature and each definition, and requires every hit to live in its owner.
// A duplicate fails with the file:line of every hit.
import { repoPath } from "#test/path.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const JS_ROOT = repoPath("foliplus", "js");
const SKIP_DIR = new Set(["node_modules", "dist", "coverage"]);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
};

/** Blank comments, so prose that quotes a signature is not counted as code. */
const codeOnly = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, " "))
    .split(/\r?\n/)
    .map(line => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");

interface Hit {
  /** Path relative to foliplus/js, POSIX separators. */
  file: string;
  line: number;
  text: string;
}

// Read once: every primitive below counts hits over this same real tree.
const SOURCES = walk(JS_ROOT).map(path => ({
  file: relative(JS_ROOT, path).split(sep).join("/"),
  text: codeOnly(readFileSync(path, "utf8")),
}));

/** Every occurrence of `pattern`, one hit per occurrence (not per line). */
const hitsOf = (pattern: string): Hit[] => {
  const re = new RegExp(pattern, "g");
  const hits: Hit[] = [];
  for (const { file, text } of SOURCES) {
    text.split("\n").forEach((line, i) => {
      hits.push(
        ...Array.from(line.matchAll(re), () => ({
          file,
          line: i + 1,
          text: line.trim(),
        })),
      );
    });
  }
  return hits;
};

const formatHits = (hits: Hit[]): string =>
  hits.length === 0
    ? "  (no hits)"
    : hits.map(hit => `  ${hit.file}:${hit.line}  ${hit.text}`).join("\n");

interface Primitive {
  /** Exported symbol: exactly one definition, in the owner module. */
  name: string;
  /** Owner module, relative to foliplus/js. */
  owner: string;
  /** The shape a hand-rolled second copy would have to repeat. */
  drift: string;
  /** Why a second copy is a behaviour drift, not harmless duplication. */
  why: string;
}

const PRIMITIVES: Primitive[] = [
  {
    name: "attachMenuController",
    owner: "control/LayerControl/ui/overlayPanel/menu.ts",
    drift: "localId:\\s*[\"']menu[\"']",
    why: "the layer/folder/role menus share one attach scaffold; a second copy drops one of its dismissal, focus or teardown paths",
  },
  {
    name: "createPickerHolder",
    owner: "control/LayerControl/ui/style/pickerHolder.ts",
    drift: "WeakMap<\\s*LayerUI\\s*,\\s*SchemePicker\\s*>",
    why: "a second picker slot is a live SchemePicker the panel never disposes",
  },
  {
    name: "createReplayGate",
    owner: "control/LayerControl/ui/style/replay.ts",
    drift: "WeakMap<\\s*LayerUI\\s*,\\s*Set<string>\\s*>",
    why: "a second gate repaints a declared dimension twice on the same attach sweep",
  },
];

describe("single-source primitives", () => {
  it("scans the production tree, not an empty walk", () => {
    // A guard over zero files would pass every count below. The owner module is
    // also asserted per primitive, but this keeps the walk itself honest.
    expect(SOURCES.length, "walked no foliplus/js file").toBeGreaterThan(0);
    for (const primitive of PRIMITIVES) {
      expect(SOURCES.map(source => source.file)).toContain(primitive.owner);
    }
  });

  for (const primitive of PRIMITIVES) {
    describe(primitive.name, () => {
      it(`is defined exactly once, in ${primitive.owner}`, () => {
        const hits = hitsOf(`\\bconst\\s+${primitive.name}\\b`);
        expect(
          hits.length,
          `${primitive.name} must have one definition (${primitive.owner}); found:\n${formatHits(hits)}`,
        ).toBe(1);
        expect(
          hits[0].file,
          `${primitive.name} is defined outside its owner module:\n${formatHits(hits)}`,
        ).toBe(primitive.owner);
      });

      it(`owns the only driftable shape in foliplus/js: ${primitive.drift}`, () => {
        const hits = hitsOf(primitive.drift);
        expect(
          hits.length,
          `${primitive.why} — found copies:\n${formatHits(hits)}`,
        ).toBe(1);
        expect(
          hits[0].file,
          `${primitive.name}'s shape appears outside ${primitive.owner}:\n${formatHits(hits)}`,
        ).toBe(primitive.owner);
      });
    });
  }
});
