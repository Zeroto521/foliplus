import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";

// ── Static guard: the row visual is painted from one writer ─────
//
// LayerControl's layer row has five visual slots: the checkbox state, the
// ACTIVE highlight class, the feature-count column, the type-icon column,
// and the row tooltip. `applyRowView` (ui/rowView.ts) is the single writer
// for all five — every site that paints a row's decoration calls it with a
// RowCell and lets it write the DOM, rather than writing fields by hand.
//
// This scan is what keeps that invariant enforced. Without it, the claim
// "all row visual writes converge on one writer" is a code review convention,
// not a machine-checkable rule.
//
// WHAT THIS COVERS — six patterns, one per write operation:
//
//   1. checkbox.checked   — `(input|checkbox).checked =`
//      Slot 1. Variable-name-anchored: the writer and the two known consumers
//      use `input` and `checkbox`. A rename to `cb` or `el` would slip past.
//
//   2. ACTIVE class       — `item.classList.add|remove|toggle(...ACTIVE)`
//      Slot 2. Receiver-anchored on `item`, the row element. Scoped to
//      LayerControl because `CONST.CLASSES.ACTIVE` is shared with
//      MeasureControl (tool buttons) and HeatmapControl (scheme items) —
//      those are different components' own UI, not layer rows.
//
//   3. count column       — `CONST.SEL.COUNT_COL`
//      Slot 3. The selector constant is exclusive to rowView.ts. Any
//      reference outside the writer is a bypass.
//
//   4. type icon          — `querySelector(...TYPE_ICON_COL)`
//      Slot 4. The selection that precedes the innerHTML write. Anchored on
//      `querySelector` rather than the constant because list.ts also names
//      `TYPE_ICON_COL` in a `class:` property (DOM construction, not a state
//      write). The raw CSS string `.foliplus-type-icon-col` would slip past.
//
//   5. row data-title     — `setAttribute(...DATA.TITLE)`
//      Slot 5a. The data attribute that persists the type label. Anchored on
//      `setAttribute` because list.ts also names `DATA.TITLE` in an object
//      literal (`[CONST.DATA.TITLE]: colorType`) — construction, not a write.
//
//   6. row HTML title     — `item.title =`
//      Slot 5b. Receiver-anchored on `item`. Scoped to LayerControl because
//      HeatmapControl also writes `item.title` on its own UI items.
//
// STILL NOT CAUGHT, and worth knowing:
//
//   - A variable other than `input` / `checkbox` for a row checkbox:
//     `const cb = item.querySelector(...); cb.checked = false`.
//   - A variable other than `item` for the row element:
//     `const el = ...; el.classList.remove(CONST.CLASSES.ACTIVE)`.
//   - The raw CSS class string instead of the constant:
//     `item.querySelector(".foliplus-type-icon-col")`.
//   - A selector held in a variable:
//     `const sel = CONST.SEL.COUNT_COL; item.querySelector(sel)`.
//   - The checkbox tooltip alone (slot 5b's sibling):
//     `input.title = "…"` without a simultaneous `input.checked =` write.
//     The style panel (zoomRange.ts) writes `input.title` on its own inputs,
//     so the pattern cannot be anchored on `input.title` without a false
//     positive. A bypass that updates the tooltip without the checkbox state
//     would not be caught.
//
// Comments are stripped before matching, so the prose above and in the
// sources may name the fields freely. String literals are deliberately NOT
// stripped: patterns 3, 4, and 5a read from them.
//
// Widening the scan: add a pattern to PATTERNS, or loosen an anchor. The
// whitelist (OUT_OF_CHARTER) is the only way to permit an exception — every
// entry names the file, the slot, the count, and the reason.
//
// ── Patterns ───────────────────────────────────────────────────

type GuardPattern = {
  /** Which visual slot this pattern guards. */
  slot: string;
  /** The regex to match. */
  re: RegExp;
  /** If set, only scan files whose path contains this substring. */
  scope?: string;
};

const PATTERNS: GuardPattern[] = [
  {
    slot: "checkbox.checked",
    re: /\b(?:input|checkbox)\.checked\s*=/g,
  },
  {
    slot: "ACTIVE class",
    re: /\bitem\.classList\.(?:add|remove|toggle)\s*\([^)]*ACTIVE/g,
    scope: "LayerControl/",
  },
  {
    slot: "count column",
    re: /\bCONST\.SEL\.COUNT_COL\b/g,
  },
  {
    slot: "type icon",
    re: /\bquerySelector[^)]*TYPE_ICON_COL/g,
  },
  {
    slot: "row data-title",
    re: /\bsetAttribute\([^)]*DATA\.TITLE/g,
  },
  {
    slot: "row title",
    re: /\bitem\.title\s*=/g,
    scope: "LayerControl/",
  },
];

// ── Whitelist ──────────────────────────────────────────────────

// Counted exceptions to the charter, named by file, slot, count, and reason.
// A new reach in a whitelisted file beyond the recorded count still fails.
//
// The single entry is the momentary flip in focus.ts — a toggle that
// dispatches `change`, which triggers applyUserState → applyRowView and
// redraws the row from the corrected intent. It is a transient input flip,
// not a terminal visual write, so the guard permits it.
const OUT_OF_CHARTER: ReadonlyArray<{
  file: string;
  slot: string;
  n: number;
  reason: string;
}> = [
  {
    file: "LayerControl/ui/focus.ts",
    slot: "checkbox.checked",
    n: 1,
    reason:
      "momentary flip: checkbox.checked = !checkbox.checked → " +
      "dispatchEvent('change') → applyUserState → applyRowView " +
      "redraws the row from corrected intent",
  },
];

// ── Path resolution and scanning ───────────────────────────────

const WRITER = "LayerControl/ui/rowView.ts";

const REPO_ROOT = process.cwd();
const JS_ROOT = resolve(REPO_ROOT, "foliplus/js");

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
};

const rel = (p: string) => p.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");

const COMMENT_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const codeOnly = (src: string): string => src.replace(COMMENT_RE, " ");
const code = (p: string) => codeOnly(readFileSync(p, "utf-8"));

const sources = walk(JS_ROOT);

/** Count matches of `re` in the code of `filePath`. */
const matchCount = (filePath: string, re: RegExp): number => {
  const src = code(filePath);
  re.lastIndex = 0;
  return (src.match(re) || []).length;
};

/** Whether a file path falls within a pattern's scope. */
const inScope = (relPath: string, scope: string | undefined): boolean => {
  if (!scope) return true;
  return relPath.includes(scope);
};

// Build the allowance map: file → slot → count.
const allowances = new Map<string, Map<string, number>>();
for (const { file, slot, n } of OUT_OF_CHARTER) {
  const key = `foliplus/js/${file}`;
  if (!allowances.has(key)) allowances.set(key, new Map());
  allowances.get(key)!.set(slot, n);
}

// ── Tests ──────────────────────────────────────────────────────

describe("applyRowView is the only module writing row visual slots", () => {
  it("scans a non-trivial production tree", () => {
    expect(sources.length).toBeGreaterThanOrEqual(80);
  });

  it("confines every row visual write to the writer or to a counted exception", () => {
    // The exception list holds exactly one entry (focus.ts). That is the
    // state the guard asserts on, so a new allowance shows up as an edit
    // to the array and to this assertion together, not as a quietly
    // widened scan.
    expect(OUT_OF_CHARTER).toHaveLength(1);

    const problems: string[] = [];
    for (const file of sources) {
      const name = rel(file);
      if (name === `foliplus/js/${WRITER}`) continue;

      const fileAllowances = allowances.get(name);
      for (const pattern of PATTERNS) {
        if (!inScope(name, pattern.scope)) continue;
        const found = matchCount(file, pattern.re);
        const allowed = fileAllowances?.get(pattern.slot) ?? 0;
        if (found > allowed) {
          problems.push(
            `${name}: "${pattern.slot}" ${found}` +
              `${allowed ? ` > ${allowed}` : " (no allowance)"}`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("every counted exception is still exactly as large as recorded", () => {
    // An allowance that outlives its reach would quietly cover the next one.
    for (const { file, slot, n } of OUT_OF_CHARTER) {
      const pattern = PATTERNS.find(p => p.slot === slot);
      expect(pattern, `no pattern for slot "${slot}"`).toBeDefined();
      const path = resolve(JS_ROOT, file);
      expect(matchCount(path, pattern!.re), file).toBe(n);
    }
  });

  it("the writer really holds all of them, so the scan cannot pass vacuously", () => {
    // A pattern that matches nothing in rowView.ts would mean the scan
    // passes vacuously — it guards a slot the writer does not own.
    const writerPath = resolve(JS_ROOT, WRITER);
    for (const pattern of PATTERNS) {
      if (!inScope(`foliplus/js/${WRITER}`, pattern.scope)) continue;
      expect(matchCount(writerPath, pattern.re), pattern.slot).toBeGreaterThanOrEqual(
        1,
      );
    }
  });
});

// ── Pattern unit tests ─────────────────────────────────────────
//
// Each test exercises the anchors that make the pattern work, and the false
// friends the anchors keep out. These are the same shapes that appear in
// the production tree, not synthetic ones.

describe("pattern anchors", () => {
  const matched = (src: string, re: RegExp): string[] => {
    re.lastIndex = 0;
    return src.match(re) ?? [];
  };

  it("slot 1: catches checked writes on input and checkbox variables", () => {
    const re = PATTERNS[0].re;
    expect(matched("input.checked = view.checked", re)).toHaveLength(1);
    expect(matched("checkbox.checked = !checkbox.checked", re)).toHaveLength(1);
    expect(matched("if (input) input.checked = false", re)).toHaveLength(1);
  });

  it("slot 1: does not match other checkbox variables", () => {
    // labelControl.ts uses showInput and collideInput for its own checkboxes.
    // visibility.ts uses allCb for the select-all checkbox. None are row
    // checkboxes, and the variable-name anchor keeps them out.
    const re = PATTERNS[0].re;
    expect(matched("showInput.checked = !!v.labelShow", re)).toEqual([]);
    expect(matched("collideInput.checked = v.labelCollide !== false", re)).toEqual([]);
    expect(matched("allCb.checked = allChecked", re)).toEqual([]);
    // The residual gap: a rename to `cb` or `el` would slip past.
    expect(matched("cb.checked = false", re)).toEqual([]);
  });

  it("slot 2: catches classList writes to ACTIVE on item variables", () => {
    const re = PATTERNS[1].re;
    expect(
      matched("item.classList.toggle(CONST.CLASSES.ACTIVE, view.active)", re),
    ).toHaveLength(1);
    expect(matched("item.classList.remove(CONST.CLASSES.ACTIVE)", re)).toHaveLength(1);
    expect(matched("item.classList.add(CONST.CLASSES.ACTIVE)", re)).toHaveLength(1);
  });

  it("slot 2: does not match non-row ACTIVE writes", () => {
    const re = PATTERNS[1].re;
    // MeasureControl writes ACTIVE on tool buttons, not row items.
    expect(
      matched(
        "btn.classList.toggle(CONST.CLASSES.ACTIVE, btn.dataset.mode === mode)",
        re,
      ),
    ).toEqual([]);
    // The map container is not a row item.
    expect(
      matched("ui.m.map.getContainer().classList.add(CONST.CLASSES.ACTIVE)", re),
    ).toEqual([]);
    // The color item is not a layer row.
    expect(matched("?.classList.add(CONST.CLASSES.ACTIVE)", re)).toEqual([]);
    // Residual gap: a rename of `item` to `el` would slip past.
    expect(matched("el.classList.remove(CONST.CLASSES.ACTIVE)", re)).toEqual([]);
  });

  it("slot 3: catches the count column selector", () => {
    const re = PATTERNS[2].re;
    expect(matched("item.querySelector(CONST.SEL.COUNT_COL)", re)).toHaveLength(1);
    // The class constant (used in list.ts for DOM construction) is not the
    // selector — the guard anchors on SEL, which is the selector namespace.
    expect(matched("class: CONST.CLASSES.COUNT_COL", re)).toEqual([]);
  });

  it("slot 4: catches the type icon selection", () => {
    const re = PATTERNS[3].re;
    expect(
      matched("item.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`)", re),
    ).toHaveLength(1);
    // list.ts names TYPE_ICON_COL in a class property, not a querySelector.
    expect(matched("class: CONST.CLASSES.TYPE_ICON_COL", re)).toEqual([]);
    // Residual gap: the raw CSS string would slip past.
    expect(matched('item.querySelector(".foliplus-type-icon-col")', re)).toEqual([]);
  });

  it("slot 5a: catches the data-title attribute write", () => {
    const re = PATTERNS[4].re;
    expect(
      matched("item.setAttribute(CONST.DATA.TITLE, view.typeLabel)", re),
    ).toHaveLength(1);
    // list.ts names DATA.TITLE in an object literal (construction, not a write).
    expect(matched("[CONST.DATA.TITLE]: colorType", re)).toEqual([]);
  });

  it("slot 5b: catches the row HTML title write", () => {
    const re = PATTERNS[5].re;
    expect(matched("item.title = view.title", re)).toHaveLength(1);
    // HeatmapControl writes item.title on its own UI items (different scope).
    expect(matched("item.title = name", re)).toHaveLength(1);
  });

  it("slot 5b: the checkbox tooltip is not guarded — documented gap", () => {
    // The writer writes both input.title (checkbox tooltip) and item.title
    // (row tooltip). The checkbox tooltip pattern (input.title =) is shared
    // with zoomRange.ts (style panel inputs), so it cannot be anchored on
    // `input.title` without a false positive. A bypass that updates only the
    // checkbox tooltip — without also writing input.checked — would not be
    // caught. The checked write (slot 1) is written alongside the tooltip in
    // the writer, so a simultaneous bypass of both is caught by slot 1.
    const re = PATTERNS[5].re;
    expect(matched("input.title = view.checkboxTitle", re)).toEqual([]);
    expect(matched("input.title = `x ${value}`", re)).toEqual([]);
  });
});
