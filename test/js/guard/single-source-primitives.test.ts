// Guard: the three single-source primitives #1407 extracted keep exactly one
// definition and one driftable shape in the production tree.
//
// #1407 pulled three repeated shapes into one module each:
//   - attachMenuController — control/LayerControl/ui/overlayPanel/menu.ts, the
//     one layer/folder/role menu attach scaffold, keyed localId: "menu".
//   - createPickerHolder — control/LayerControl/ui/style/pickerHolder.ts, the
//     one per-UI scheme-picker slot: a WeakMap<LayerUI, SchemePicker> with one
//     dispose (the picker's overlay unregister is the listbox engine's now).
//   - createReplayGate — control/LayerControl/ui/style/replay.ts, the one per-UI
//     declared-replay gate: a WeakMap<LayerUI, Set<string>>.
//
// Extraction alone does not stop a later caller from hand-rolling the shape
// again, and the copies drift silently: a menu that skips one dismissal path, a
// picker slot the panel never disposes, a gate that repaints a declared
// dimension twice. So this guard reads the real foliplus/js/** tree and pins
// each primitive to exactly one definition and one occurrence of each driftable
// shape, all inside the owner module, printing file:line for every hit.
//
// Matching is deliberately unfussy about spelling, because the copy this guard
// exists to catch is written by hand:
//   - comments are blanked with the TypeScript parser, so a "//" inside a URL
//     string does not truncate the code that follows it on the line;
//   - whitespace runs collapse to one space before matching, so a signature
//     split across lines still counts;
//   - quotes are matched in all three forms ("menu", 'menu', `menu`) and a
//     definition accepts const/let/var/function.
import { repoPath } from "#test/path.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
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

/**
 * Blank every comment while keeping strings, template literals and regex
 * literals byte-for-byte. The parser decides what a comment is, so a URL such
 * as "https://…" does not swallow the code that follows it on the same line —
 * the failure mode of a hand-rolled `indexOf("//")`.
 */
export const blankComments = (text: string): string => {
  const source = ts.createSourceFile(
    "scan.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const chars = text.split("");
  const blank = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      for (let i = range.pos; i < range.end; i++) {
        if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
      }
    }
  };
  const collect = (node: ts.Node): void => {
    blank(ts.getLeadingCommentRanges(source.text, node.getFullStart()));
    blank(ts.getTrailingCommentRanges(source.text, node.getEnd()));
    for (const child of node.getChildren(source)) collect(child);
  };
  collect(source);
  return chars.join("");
};

/**
 * Collapse every whitespace run to one space, so a signature broken across
 * lines matches, and keep a normalized-index → 1-based-line map so a hit still
 * reports the line it starts on.
 */
export const normalize = (text: string): { text: string; lineAt: number[] } => {
  const chars: string[] = [];
  const lineAt: number[] = [];
  let line = 1;
  let pendingSpace = false;
  for (const ch of text) {
    if (ch === "\n") {
      line += 1;
      pendingSpace = true;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v") {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && chars.length > 0) {
      chars.push(" ");
      lineAt.push(line);
    }
    pendingSpace = false;
    chars.push(ch);
    lineAt.push(line);
  }
  return { text: chars.join(""), lineAt };
};

interface Hit {
  /** Path relative to foliplus/js, POSIX separators. */
  file: string;
  line: number;
  text: string;
}

interface Source {
  file: string;
  /** Raw lines, for the file:line report. */
  lines: string[];
  /** Whitespace-collapsed, comment-blanked code. */
  normalized: string;
  lineAt: number[];
}

// Read and parse once: every primitive below counts hits over this same tree.
const SOURCES: Source[] = walk(JS_ROOT).map(path => {
  const raw = readFileSync(path, "utf8");
  const { text, lineAt } = normalize(blankComments(raw));
  return {
    file: relative(JS_ROOT, path).split(sep).join("/"),
    lines: raw.split(/\r?\n/),
    normalized: text,
    lineAt,
  };
});

/** Every occurrence of `pattern`, searched over the normalized code only. */
const hitsOf = (pattern: string): Hit[] => {
  const re = new RegExp(pattern, "g");
  const hits: Hit[] = [];
  for (const source of SOURCES) {
    for (const match of source.normalized.matchAll(re)) {
      const line = source.lineAt[match.index ?? 0] ?? 1;
      hits.push({
        file: source.file,
        line,
        text: (source.lines[line - 1] ?? "").trim(),
      });
    }
  }
  return hits;
};

const formatHits = (hits: Hit[]): string =>
  hits.length === 0
    ? "  (no hits)"
    : hits.map(hit => `  ${hit.file}:${hit.line}  ${hit.text}`).join("\n");

interface Shape {
  /** Regex source, matched against whitespace-normalized code. */
  pattern: string;
  /** Why a second copy is a behaviour drift, not harmless duplication. */
  why: string;
}

interface Primitive {
  /** Exported symbol: exactly one definition, in the owner module. */
  name: string;
  /** Owner module, relative to foliplus/js. */
  owner: string;
  shapes: Shape[];
}

const PRIMITIVES: Primitive[] = [
  {
    name: "attachMenuController",
    owner: "control/LayerControl/ui/overlayPanel/menu.ts",
    shapes: [
      {
        pattern: "localId:\\s*(?:\"menu\"|'menu'|`menu`)",
        why: "the layer/folder/role menus share one attach scaffold; a second copy drops one of its dismissal, focus or teardown paths",
      },
    ],
  },
  {
    name: "createPickerHolder",
    owner: "control/LayerControl/ui/style/pickerHolder.ts",
    shapes: [
      {
        pattern: "WeakMap<\\s*LayerUI\\s*,\\s*SchemePicker\\s*>",
        why: "a second picker slot is a live SchemePicker the panel never disposes",
      },
    ],
  },
  {
    name: "createReplayGate",
    owner: "control/LayerControl/ui/style/replay.ts",
    shapes: [
      {
        pattern: "WeakMap<\\s*LayerUI\\s*,\\s*Set<string>\\s*>",
        why: "a second gate repaints a declared dimension twice on the same attach sweep",
      },
    ],
  },
];

const patternOf = (name: string, index: number): string => {
  const primitive = PRIMITIVES.find(item => item.name === name);
  if (!primitive) throw new Error(`no primitive named ${name}`);
  return primitive.shapes[index].pattern;
};

describe("single-source primitives", () => {
  it("scans the production tree, not an empty walk", () => {
    // A guard over zero files would pass every count below.
    expect(SOURCES.length, "walked no foliplus/js file").toBeGreaterThan(0);
  });

  it("finds every owner module in the scanned tree", () => {
    // Kept separate from the per-primitive counts so a renamed owner fails on
    // its own, before it is explained away as a count mismatch.
    const scanned = new Set(SOURCES.map(source => source.file));
    const missing = PRIMITIVES.filter(primitive => !scanned.has(primitive.owner)).map(
      primitive => primitive.owner,
    );
    expect(missing, "owner module missing from the walk").toEqual([]);
  });

  for (const primitive of PRIMITIVES) {
    describe(primitive.name, () => {
      it(`is defined exactly once, in ${primitive.owner}`, () => {
        const hits = hitsOf(`(?:const|let|var|function)\\s+${primitive.name}\\b`);
        expect(
          hits.length,
          `${primitive.name} must have one definition (${primitive.owner}); found:\n${formatHits(hits)}`,
        ).toBe(1);
        expect(
          hits[0].file,
          `${primitive.name} is defined outside its owner module:\n${formatHits(hits)}`,
        ).toBe(primitive.owner);
      });

      for (const shape of primitive.shapes) {
        it(`is the only place that repeats ${shape.pattern}`, () => {
          const hits = hitsOf(shape.pattern);
          expect(hits.length, `${shape.why} — found copies:\n${formatHits(hits)}`).toBe(
            1,
          );
          expect(
            hits[0].file,
            `${primitive.name}'s shape appears outside ${primitive.owner}:\n${formatHits(hits)}`,
          ).toBe(primitive.owner);
        });
      }
    });
  }
});

describe("scan primitives", () => {
  it("keeps string contents when blanking comments", () => {
    const source = 'const endpoint = "https://example.test/x"; const kept = 1; // tail';
    const blanked = blankComments(source);
    expect(blanked).toContain("https://example.test/x");
    expect(blanked).toContain("const kept = 1;");
    expect(blanked).not.toContain("tail");
  });

  it("blanks a comment that quotes a guarded signature", () => {
    const source = "/* new WeakMap<LayerUI, Set<string>>() */\nconst kept = 1;";
    expect(blankComments(source)).not.toContain("WeakMap");
  });

  it("matches a signature split across lines", () => {
    const { text } = normalize(
      "const gate = new WeakMap<\n  LayerUI,\n  SchemePicker\n>();",
    );
    expect(new RegExp(patternOf("createPickerHolder", 0)).test(text)).toBe(true);
  });
});
