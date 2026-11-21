import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The fold-arrow single-source guard. How far a row is opened is one state -
// aria-expanded on the fold button - and the arrow may only be turned by
// that state. The two halves have to agree, or the row lies to the user:
//
//   ICON_FOLD at rest (row collapsed) = a chevron pointing RIGHT
//   aria-expanded='true' (row expanded) = turned DOWN, i.e. rotated 90deg
//
// That is tree-list semantics (VS Code file explorer, GitHub file tree,
// Ant Design Tree). collapsed = up is popup / combobox semantics and is the
// regression this file holds back: the pre-fix row.css spun an up-pointing
// chevron 180deg on fold, which rendered UP-when-expanded and DOWN-when-
// collapsed. The two angles are named once in token.css (--foliplus-fold-rot-rest,
// --foliplus-fold-rot-expanded) and applied from aria-expanded in row.css, so a
// row kind other than the role header - folder rows, container rows, added
// by #1276 - reuses the button and the rule instead of writing a rotate.

const ICON_REL = "foliplus/js/control/LayerControl/icon.ts";
const CSS_REL = "foliplus/css/control/LayerControl/row.css";
const TOKEN_REL = "foliplus/css/common/token.css";
const LIST_REL = "foliplus/js/control/LayerControl/ui/listPanel/list.ts";

type Pt = { x: number; y: number };
type Dir = "right" | "left" | "up" | "down";
type Chevron = { pts: Pt[]; dir: Dir };

// The raw polyline points list, and the build-compressed d='m18 15-6-6-6 6'
// form (deltas applied to the first point). Both spell the same chevron.
const POINT_ATTR = /points=["']([^"']+)["']/;
const PATH_ATTR = /d=["']m\s*(-?[0-9.]+)\s+(-?[0-9.]+)\s+(-?[0-9.]+)\s+(-?[0-9.]+)\s+(-?[0-9.]+)\s+(-?[0-9.]+)["']/;

// Scope the parse to the ICON_FOLD definition. icon.ts holds several chevron
// glyphs (other controls draw up- or down-pointing ones), so a bare match on
// the first points= attribute would read a neighbour's icon and report its
// direction as the fold arrow's.
const foldIconSource = (iconSrc: string): string => {
  const rows = iconSrc.split("\n");
  const first = rows.findIndex((r) => r.includes("const ICON_FOLD"));
  if (first < 0) return "";
  const block: string[] = [rows[first]];
  for (let i = first + 1; i < rows.length; i++) {
    block.push(rows[i]);
    if (/`\s*;\s*$/.test(rows[i])) return block.join("\n");
  }
  return block.join("\n");
};

const foldChevron = (iconSrc: string): Chevron | null => {
  const pl = iconSrc.match(POINT_ATTR);
  let nums: number[] | null = null;
  if (pl) {
    nums = pl[1].trim().split(/[^0-9.\-]+/).filter(Boolean).map(Number);
  } else {
    const d = iconSrc.match(PATH_ATTR);
    if (d) {
      const [ox, oy, ax, ay, bx, by] = d.slice(1, 7).map(Number);
      nums = [ox, oy, ox + ax, oy + ay, ox + bx, oy + by];
    }
  }
  if (!nums || nums.length !== 6) return null;
  const pts: Pt[] = [
    { x: nums[0], y: nums[1] },
    { x: nums[2], y: nums[3] },
    { x: nums[4], y: nums[5] },
  ];
  const [w0, tip, w1] = pts;
  const dx = tip.x - (w0.x + w1.x) / 2;
  const dy = tip.y - (w0.y + w1.y) / 2;
  let dir: Dir;
  if (Math.abs(dx) >= Math.abs(dy)) dir = dx >= 0 ? "right" : "left";
  else dir = dy >= 0 ? "down" : "up";
  return { pts, dir };
};

type Finding = { path: string; message: string };

const foldArrowFindings = (root: string): Finding[] => {
  const out: Finding[] = [];
  const read = (rel: string): string => readFileSync(resolve(root, rel), "utf-8");

  // half 1: the rest pose of ICON_FOLD is the collapsed pose.
  const ch = foldChevron(foldIconSource(read(ICON_REL)));
  if (!ch) {
    out.push({ path: ICON_REL, message: "ICON_FOLD has no readable 3-point chevron" });
  } else if (ch.dir !== "right") {
    out.push({
      path: ICON_REL,
      message:
        `ICON_FOLD rests ${ch.dir}-pointing (tip ${ch.pts[1].x},${ch.pts[1].y}) - the` +
        ` collapsed pose must point right so expanding turns it down` +
        ` (right -> down), the tree-list convention. Up-when-collapsed is` +
        ` popup semantics.`,
    });
  }

  // half 2: the angles are named once in token.css, applied once in row.css.
  const css = read(CSS_REL);
  const tokens = read(TOKEN_REL);
  // Exactly two angles exist, and they are the two poses. A third one - or a
  // 180deg - is the popup-style inversion this guard exists to hold back.
  const rest =
    /--foliplus-fold-rot-rest\s*:\s*([^;\n]+)/.exec(tokens)?.[1]?.trim();
  const expanded =
    /--foliplus-fold-rot-expanded\s*:\s*([^;\n]+)/.exec(tokens)?.[1]?.trim();
  if (rest !== "0deg" || expanded !== "90deg") {
    out.push({
      path: TOKEN_REL,
      message:
        `the fold angles are ${rest} (rest) and ${expanded} (expanded) - they` +
          ` must be 0deg (rest) and 90deg (expanded). A 180deg is the` +
          " popup-style inversion the guard exists to hold back.",
    });
  }
  // row.css may only READ those tokens. Naming a fold angle here would be a
  // second source of the angle, and style-check rule 4 keeps every
  // --foliplus-* definition in token.css for the same reason.
  if (/--foliplus-fold-rot-(?:rest|expanded)\s*:/.test(css)) {
    out.push({
      path: CSS_REL,
      message:
        "row.css defines a fold angle - the two poses belong to token.css, so " +
        "the angle keeps a single source.",
    });
  }
  const expandedRule = /\[aria-expanded=["']true["']\]/.test(css);
  if (!expandedRule) {
    out.push({
      path: CSS_REL,
      message:
        "no selector on [aria-expanded=true] turns the fold arrow - the arrow" +
        " must be driven by that state, not by a parallel folded class.",
    });
  }
  if (/\btransform\s*:[^;]*rotate\(\s*-?180deg\s*\)/.test(css)) {
    out.push({
      path: CSS_REL,
      message:
        "row.css still contains a rotate(180deg) - the old up/down inversion." +
        " The flipped pose is the aria-expanded override, not a full spin.",
    });
  }

  // half 3: list.ts feeds aria-expanded from the same state.
  const rowBody =
    read(LIST_REL).split("const renderToggleAllRow").slice(1, 2)[0] ?? "";
  const ariaFromState =
    /aria-expanded["']?\s*:*\s*isFolded\s*\?\s*["']false["']\s*:*\s*["']true["']/.test(rowBody);
  if (!ariaFromState) {
    out.push({
      path: LIST_REL,
      message:
        "renderToggleAllRow does not set aria-expanded from isFolded, so the" +
        " fold arrow has no single source of state to be driven by.",
    });
  }
  // The FOLDED class is one projection of the same isFolded state, so the row
  // frame and the arrow cannot disagree. It must sit close behind the ternary,
  // not be derived from a second source.
  if (!/isFolded\s*\?[^]{0,120}FOLDED/.test(rowBody)) {
    out.push({
      path: LIST_REL,
      message:
        "the foliplus-layer-folded class is no longer derived from isFolded - " +
        "the row frame and the arrow would then be able to disagree.",
    });
  }
  return out;
};

const REPO_ROOT = process.cwd();

describe("fold arrow direction is one mechanism", () => {
  it("reports no violation in the current tree", { timeout: 20000 }, () => {
    expect(foldArrowFindings(REPO_ROOT)).toEqual([]);
  });

  it("pins ICON_FOLD to the collapsed right rest pose", () => {
    const src = foldIconSource(readFileSync(resolve(REPO_ROOT, ICON_REL), "utf-8"));
    const ch = foldChevron(src);
    expect(ch, "ICON_FOLD must carry a readable 3-point chevron").not.toBeNull();
    expect(ch?.dir).toBe("right");
  });

  it("pins the aria-expanded rule as the only thing that turns it", () => {
    const css = readFileSync(resolve(REPO_ROOT, CSS_REL), "utf-8");
    const tokens = readFileSync(resolve(REPO_ROOT, TOKEN_REL), "utf-8");
    const rest = /--foliplus-fold-rot-rest\s*:\s*([^;\n]+)/.exec(tokens)?.[1]?.trim();
    const expanded = /--foliplus-fold-rot-expanded\s*:\s*([^;\n]+)/.exec(
      tokens,
    )?.[1]?.trim();
    expect([rest, expanded]).toEqual(["0deg", "90deg"]);
    expect(css).toMatch(/\[aria-expanded=["']true["']\]/);
    expect(css).not.toMatch(/rotate\(\s*-?180deg\s*\)/);
  });

  it.each(["role", "folder", "container"])(
    "turns every row kind (${k}) through the shared aria-expanded rule",
    (k) => {
      // The row kind is the parameter here: today only role rows are rendered,
      // but folder rows and container rows (#1276) reuse this same button, so
      // the invariant is stated per kind - each one must turn through the shared
      // angle rather than carrying a literal of its own.
      const css = readFileSync(resolve(REPO_ROOT, CSS_REL), "utf-8");
      // A rotate( containing a nested var( is the shared one. Every rotate( with
      // no nesting is a literal angle written beside it, which is exactly what
      // would let a row kind grow its own direction.
      const literals = (css.match(/rotate\([^)]*\)/g) ?? []).filter(
        (t) => !t.includes("var("),
      );
      expect(
        literals,
        `every kind (${k}) must read the shared --foliplus-fold-rot angle`,
      ).toEqual([]);
    },
  );

  it("flags each half independently on a synthetic regression tree", () => {
    const dir = mkdtempSync(join(tmpdir(), "fold-arrow-"));
    const iconDir = join(dir, "foliplus", "js", "control", "LayerControl");
    const cssDir = join(dir, "foliplus", "css", "control", "LayerControl");
    const commonDir = join(dir, "foliplus", "css", "common");
    const listDir = join(dir, "foliplus", "js", "control", "LayerControl", "ui", "listPanel");
    mkdirSync(iconDir, { recursive: true });
    mkdirSync(cssDir, { recursive: true });
    mkdirSync(commonDir, { recursive: true });
    mkdirSync(listDir, { recursive: true });
    // The exact pre-fix tree: an up-chevron at rest, a 180deg spin on fold,
    // and no aria-expanded anywhere for the arrow to be driven by.
    writeFileSync(
      join(iconDir, "icon.ts"),
      `const ICON_FOLD = "<svg viewBox=\"0 0 24 24\"><polyline points=\"18 15 12 9 6 15\"/></svg>";`,
    );
    writeFileSync(
      join(cssDir, "row.css"),
      ".foliplus-layer-fold-btn svg { display: block; }\n" +
        ".foliplus-layer-toggle-all.foliplus-layer-folded .foliplus-layer-fold-btn svg {\n  transform: rotate(180deg);\n}\n",
    );
    // The pre-fix tree had no fold token at all: the angle was a literal in
    // row.css, so token.css carries neither pose to be named.
    writeFileSync(
      join(commonDir, "token.css"),
      ":root {\n  --foliplus-space-xl: 16px;\n}\n",
    );
    writeFileSync(
      join(listDir, "list.ts"),
      `const renderToggleAllRow = (ui, role) => {\n  const isFolded = ui.foldedRoles.has(role);\n  return { class: isFolded ? \"a\" : \"b\" };\n};\n`,
    );
    const hits = foldArrowFindings(dir);
    rmSync(dir, { recursive: true, force: true });
    const where = (part: string) => hits.filter((h) => h.path.includes(part));
    expect(where(ICON_REL)[0]?.message).toContain("up-pointing");
    expect(where(CSS_REL).some((h) => h.message.includes("rotate(180deg)"))).toBe(true);
    expect(where(TOKEN_REL).some((h) => h.message.includes("the fold angles are"))).toBe(true);
    expect(where(CSS_REL).some((h) => h.message.includes("aria-expanded"))).toBe(true);
    expect(where(LIST_REL)[0]?.message).toContain("aria-expanded");
    expect(hits.length).toBeGreaterThanOrEqual(4);
  });
});

export { foldArrowFindings, foldChevron };
