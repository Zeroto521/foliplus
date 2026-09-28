import { readFileSync } from "fs";
import { resolve } from "path";
import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";

// Tracked listener registrations in foliplus/js.
//
// This file used to live inside toolchain-guard.test.ts. The split keeps
// the listener rules here (they constrain the production tree, not the
// build toolchain) and leaves the rest in toolchain-guard.test.ts: script/
// module surface, the #script/* import alias, eslint.config.js scoping,
// test/js/script naming, and script-module coverage.
//
// Resolved against cwd, the same repo root every build script assumes.
const ROOT = resolve(".");

// ── Tracked listener registrations in foliplus/js ───────────────────────────
//
// Two banned forms, one mechanism. The pre-`BaseControl.on` design made
// document/window-level and capture registrations inexpressible via the base
// class, which is exactly why so many controls reached for `addEventListener`
// and then had to hand-track the removal in a component-owned field. The
// refactor adds `BaseControl.on` with a shared lifecycle `signal`, so
// `capture: true` and window-level targets are first-class again.
//
// `L.DomEvent.on(` is the older half of the same leak: Leaflet's DOM wrapper
// takes no `signal` and returns no unbind closure, so a caller that uses it
// has to remember `L.DomEvent.off` and nothing fails loudly when they don't.
// Same mechanism, same allow-list shape, so the two are guarded together.
//
// `.onclick =` is deliberately not part of either guard: `onclick = null` is
// the legitimate way to clear a handler, and banning the assignment form would
// buy nothing but noise.
//
// Each allow-list entry pins the exact call count for its file, so a new call
// in the same file still fails. The addEventListener list is intentionally
// large (this is the *downstream* work scoped out of the refactor); it is what
// makes the next migration visible.
//
// `pairedOff` pins the paired-off count for this entry: 0 means "not
// exempted by removal pairing" — the `reason` field carries the actual
// justification. The tree has zero `L.DomEvent.off(` calls today (a separate
// assertion below), so no entry can pair off its removal. If a legitimate
// paired-off ever appears, bump this number and update the tree-level
// assertion together — never bypass the schema pin to hide the drift.
type AllowEntry = {
  f: string; // relative to foliplus/js/
  n: number; // exact call count
  pairedOff: number; // 0 today; paired-off removal count if/when introduced
  reason: string;
};

const BARE_ADD_EVENT_LISTENER: ReadonlyArray<AllowEntry> = [
  {
    f: "BaseControl.ts",
    n: 1,
    pairedOff: 0,
    reason: "the only sanctioned entry point — `on()` is the sole implementation",
  },
  {
    f: "common/fetch.ts",
    n: 1,
    pairedOff: 0,
    reason:
      "signal.addEventListener('abort', ...) is AbortSignal composition, not a DOM listener — no control instance in scope",
  },
  {
    f: "common/dom.ts",
    n: 2,
    pairedOff: 0,
    reason:
      "free-standing input-commit helper; the caller owns teardown, and BaseControl can't be reached from the helper's signature",
  },
  {
    f: "common/panel.ts",
    n: 2,
    pairedOff: 0,
    reason:
      "both calls are in bindOutsideCollapse, which binds a capture + bubble click pair on document and returns its own unbind closure — that is exactly the `effect` case, but the factory takes a container, not a BaseControl instance, so the control must register the closure itself",
  },
  {
    f: "core/hint.ts",
    n: 1,
    pairedOff: 0,
    reason:
      "HintManager registers fullscreenchange at document level; the manager owns its own lifecycle, independent of any single control",
  },
  {
    f: "core/interaction.ts",
    n: 2,
    pairedOff: 0,
    reason:
      "KeyboardManager binds per-element + document listeners on behalf of multiple controls; migration means threading a signal through the manager API",
  },
  {
    f: "core/labelControl.ts",
    n: 1,
    pairedOff: 0,
    reason:
      "free-standing label widget in core, not yet routed through a BaseControl instance",
  },
  {
    f: "core/listCursor.ts",
    n: 1,
    pairedOff: 0,
    reason:
      "free-standing list-cursor utility — keydown binding owned by the caller, no control in scope",
  },
  {
    f: "ExportControl/session.ts",
    n: 1,
    pairedOff: 0,
    reason:
      "image preview click-dismiss on an ephemeral overlay img. ExportManager is a plain class (not a BaseControl subclass) with no mounting signal to route through; the listener is self-terminating — paired removeEventListener inside the same closure, plus a bounded setTimeout — and threading a signal would mean a manager↔control callback surface for no gain: an abort would drop the listener but not the img, which would linger on document.body until the timer fires anyway",
  },
  {
    f: "LayerControl/ui/attr.ts",
    n: 3,
    pairedOff: 0,
    reason: "attribute panel event bindings — pending migration to `this.on`",
  },
  {
    f: "LayerControl/ui/lifecycle.ts",
    n: 13,
    pairedOff: 0,
    reason:
      "layer list / drag / reorder / more-menu bindings — pending migration to `this.on`",
  },
  {
    f: "LayerControl/ui/menu.ts",
    n: 1,
    pairedOff: 0,
    reason: "more-menu outside-click — pending migration to `this.on`",
  },
  {
    f: "LayerControl/ui/style/index.ts",
    n: 5,
    pairedOff: 0,
    reason:
      "style-panel input / dropdown / opacity bindings — pending migration to `this.on`",
  },
  {
    f: "MeasureControl/mode/circle.ts",
    n: 1,
    pairedOff: 0,
    reason:
      "ripple animationend on an ephemeral decoration layer: a one-shot listener that terminates itself (paired removeEventListener in the handler) and is collected with the element the moment the ripple is removed. CircleMode extends MeasureMode, not BaseControl, so no mounting signal is in scope",
  },
  {
    f: "MeasureControl/util.ts",
    n: 1,
    pairedOff: 0,
    reason:
      "dash-sweep animationend on a finalized geometry's own SVG element: one-shot and self-terminating (paired removeEventListener in the handler), and collected with the element when the measurement is deleted. animateDashSweep is a free-standing function whose callers are MeasureMode subclasses — threading a signal would cross MeasureManager → MeasureMode → both call sites, which is not worth a listener that can never outlive its animation",
  },
];

// `L.DomEvent.on(` is rare in this tree, which is the point of the guard: one
// file, three calls, all in the same pair of factories. Quantified before the
// entry was written, not after.
const L_DOM_EVENT_ON: ReadonlyArray<AllowEntry> = [
  {
    f: "common/panel.ts",
    n: 3,
    pairedOff: 0,
    reason:
      "all three bind to elements inside a panel container subtree: bindPanelToggle (2) resolves button and header via container.querySelector, bindFoldToggle (1) receives the toggle button from createFoldControl. Leaflet stores the listener on the target element's own _leaflet_events, so it is collected with the container — the tree has zero L.DomEvent.off calls, nothing pairs them off. Both factories are free-standing: their signatures take a container/opts object, not a BaseControl instance, so `this.on` is unreachable from inside them",
  },
];

// Module-level `map.on` in a `*Control/index.ts` entry file: the only
// legitimate shape is a listener that must outlive any single control
// mounting (e.g. the CORS pre-setup that binds `layeradd` before the
// control is added, so re-adding the control does not break export).
// `this.onMap` would bind it to one control instance and `removeControl`
// would unbind it — the opposite of what these listeners need.
const MAP_ON_ALLOW_LISTENER: ReadonlyArray<AllowEntry> = [];

// The addEventListener match needs a `.` prefix so `addEventListener(` at the
// start of a line or behind a paren is still caught, and it does not match
// `removeEventListener(` — after `document.` comes `remove…`, not `addEventListener`.
const BARE_RE = /\.\s*addEventListener\s*\(/g;
// `L.DomEvent.on(` and not `L.DomEvent.once(`: `.once` is Leaflet's
// auto-removing variant, which unbinds itself after the first fire, so it is
// not a leak in the same sense. Zero occurrences in the tree today; the
// counter-proof below pins that it is excluded on purpose.
const DOM_EVENT_ON_RE = /\bL\.DomEvent\.on\s*\(/g;
// The paired-off side: today zero `L.DomEvent.off(` calls exist in the tree.
// This is what makes every allow-list entry's `pairedOff: 0` honest. A
// legitimate paired-off would require bumping both this assertion and the
// schema pin together.
const DOM_EVENT_OFF_RE = /\bL\.DomEvent\.off\s*\(/g;

// `map.on(` outside a control instance: the scope is restricted to
// `*Control/index.ts` — the module-level entry files where a stray
// `map.on` would not be owned by any single control mounting. A tree-wide
// guard would need a whole-tree whitelist (23 hits across core/, manager,
// ui, common) that is pure noise; the scoped guard catches the real leak
// without the boilerplate.
const MAP_ON_RE = /(?<!\.)\bmap\.on\s*\(/g;

/**
 * Strip line and block comments from TypeScript source, but skip over
 * string literals (single, double, backtick) and regex literals so that
 * a slash-slash inside a URL or a regex is not misinterpreted as a
 * comment start.
 *
 * This is a character-by-character scanner: it tracks whether the current
 * position is inside a string, template literal, or regex, and only
 * treats slash-slash or block-comment delimiters as comments when we
 * are in "code" mode.
 */
const stripComments = (src: string): string => {
  let out = "";
  let i = 0;
  const n = src.length;
  let prev = "";
  while (i < n) {
    const ch = src[i];
    const next = i + 1 < n ? src[i + 1] : "";
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      out += " ";
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      out += ch;
      i++;
      while (i < n && src[i] !== ch) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
        } else {
          out += src[i];
          i++;
        }
      }
      if (i < n) {
        out += src[i];
        i++;
      }
      prev = ch;
      continue;
    }
    if (ch === "`") {
      out += ch;
      i++;
      while (i < n && src[i] !== "`") {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
        } else if (src[i] === "$" && src[i + 1] === "{") {
          out += src[i] + src[i + 1];
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            if (depth > 0) out += src[i];
            i++;
          }
        } else {
          out += src[i];
          i++;
        }
      }
      if (i < n) {
        out += src[i];
        i++;
      }
      prev = "`";
      continue;
    }
    if (ch === "/" && prev !== "a-zA-Z0-9_$)" && !"].}'.\"`".includes(prev)) {
      out += ch;
      i++;
      while (i < n && src[i] !== "/") {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (src[i] === "\n") {
          out += "/";
          prev = "/";
          break;
        }
        out += src[i];
        i++;
      }
      if (i < n && src[i] === "/") {
        out += src[i];
        i++;
      }
      prev = "/";
      continue;
    }
    out += ch;
    if (ch.trim() !== "") prev = ch;
    i++;
  }
  return out;
};

// `.match(g)` is the only stateless match-with-global API: switching to
// `.test()` or `.exec()` would make the regex carry `lastIndex` between
// calls and silently miss matches on the second and later iterations.
const callsIn = (src: string, re: RegExp): number =>
  stripComments(src).match(re)?.length ?? 0;

/**
 * Per-file call count measured against the production tree. `scope` narrows
 * the glob to a subset of the tree (e.g. `*Control/index.ts` for the
 * module-level `map.on` guard, which lives outside any single control
 * instance and would otherwise need a whole-tree whitelist).
 */
const scan = (re: RegExp, scope?: string[]): Array<{ f: string; n: number }> => {
  const hits: Array<{ f: string; n: number }> = [];
  const files = globSync({
    cwd: ROOT,
    patterns: scope ?? ["foliplus/js/**/*.ts"],
  }).sort();
  for (const rel of files) {
    const n = callsIn(readFileSync(resolve(ROOT, rel), "utf8"), re);
    if (n > 0) hits.push({ f: rel.replace(/^foliplus\/js\//, ""), n });
  }
  return hits;
};

/**
 * Compare a measured per-file call count against an allow-list.
 *
 * Pure on purpose: no fs, no regex, no glob. `tree` is what the scan
 * measured, `allow` is the pinned list, and one string per discrepancy comes
 * back. The counter-proofs below assert on synthetic input through this
 * function, so they exercise the same decision the real test does — an
 * earlier draft asserted on a parallel re-implementation of the loop, which
 * kept passing even after the loop itself was gutted.
 */
const checkListenerRegistrations = (
  call: string,
  tree: ReadonlyArray<{ f: string; n: number }>,
  allow: ReadonlyArray<{ f: string; n: number; pairedOff: number }>,
): string[] => {
  const problems: string[] = [];
  const pinned = new Map<string, number>();
  for (const e of allow) {
    if (pinned.has(e.f)) {
      problems.push(
        `${e.f}: duplicate allow-list entry — first pins n=${pinned.get(e.f)}, ` +
          `this one says n=${e.n}`,
      );
      continue;
    }
    pinned.set(e.f, e.n);
    // Schema pin: today no entry pairs off its removal. The `reason` field
    // carries the justification; a nonzero pairedOff would need to be
    // accompanied by a corresponding `L.DomEvent.off(` (or removeEventListener)
    // in the tree and a deliberate bump of this pin.
    if (e.pairedOff !== 0) {
      problems.push(
        `${e.f}: allow-list pins pairedOff=${e.pairedOff} — today's schema ` +
          `requires 0 (no paired-off removals exist in the tree). Bump the ` +
          `tree-level L.DomEvent.off counter-proof at the same time.`,
      );
    }
  }

  // `seen` means "the scan reached this file", not "the count matched". A
  // file with a drifted count is reported once as a drift; a file the scan
  // never touched at all is reported once as stale.
  const seen = new Set<string>();
  for (const { f, n } of tree) {
    seen.add(f);
    const expected = pinned.get(f);
    if (expected === undefined) {
      problems.push(
        `${f}: ${n} ${call} call(s) — not on the allow-list; route it ` +
          `through the tracked entry or add an entry with the reason`,
      );
    } else if (n !== expected) {
      problems.push(
        `${f}: ${n} ${call} call(s), allow-list pins ${expected} — a new one ` +
          `crept in, or the file was already migrated (drop the entry)`,
      );
    }
  }

  for (const e of allow) {
    if (!seen.has(e.f)) {
      problems.push(
        `${e.f}: allow-list entry (n=${e.n}) but the scan found no ${call} ` +
          `call — the entry is stale, remove it`,
      );
    }
  }
  return problems;
};

describe("no bare addEventListener in foliplus/js", () => {
  it("every bare call is on the allow-list, and the allow-list still matches the tree", () => {
    expect(
      checkListenerRegistrations(
        "bare addEventListener",
        scan(BARE_RE),
        BARE_ADD_EVENT_LISTENER,
      ),
    ).toEqual([]);
  });

  it("BaseControl.ts is actually the sole addEventListener implementation", () => {
    // Counter-proof. Without this the allow-list's BaseControl entry would
    // let the guard pass vacuously after someone moved the entry point out
    // (e.g. inlined it into each component) — the whole point of the guard
    // would collapse silently.
    const src = readFileSync(resolve(ROOT, "foliplus/js/BaseControl.ts"), "utf8");
    expect(stripComments(src)).toMatch(/target\.addEventListener\(/);
    expect(stripComments(src)).toMatch(/signal/);
  });
});

describe("no L.DomEvent.on in foliplus/js", () => {
  it("every L.DomEvent.on call is on the allow-list, and the allow-list still matches the tree", () => {
    expect(
      checkListenerRegistrations(
        "L.DomEvent.on",
        scan(DOM_EVENT_ON_RE),
        L_DOM_EVENT_ON,
      ),
    ).toEqual([]);
  });
});

describe("no module-level map.on in *Control/index.ts", () => {
  // The scope is the 8 `*Control/index.ts` entry files. A counter-proof
  // below names them all explicitly so a future glob change (adding or
  // dropping one) shows up here, not silently in the scan.
  it("every module-level map.on in *Control/index.ts is on the allow-list", () => {
    expect(
      checkListenerRegistrations(
        "map.on",
        scan(MAP_ON_RE, ["foliplus/js/*Control/index.ts"]),
        MAP_ON_ALLOW_LISTENER,
      ),
    ).toEqual([]);
  });

  it("the glob scope names exactly the 8 control entry files", () => {
    // Counter-proof. Without this a glob typo (`*Control/*.ts` or
    // `*Control/index.*`) would silently widen or narrow the scope and no
    // test would notice.
    expect(
      globSync({
        cwd: ROOT,
        patterns: ["foliplus/js/*Control/index.ts"],
      }).sort(),
    ).toEqual([
      "foliplus/js/ExportControl/index.ts",
      "foliplus/js/FullscreenControl/index.ts",
      "foliplus/js/HeatmapControl/index.ts",
      "foliplus/js/LayerControl/index.ts",
      "foliplus/js/LocateControl/index.ts",
      "foliplus/js/MeasureControl/index.ts",
      "foliplus/js/ScaleControl/index.ts",
      "foliplus/js/SearchControl/index.ts",
    ]);
  });
});

describe("pairedOff schema and tree", () => {
  // Tree-level counter-proof: today zero `L.DomEvent.off(` calls exist. Every
  // allow-list entry pins `pairedOff: 0` on that basis. If a legitimate
  // paired-off ever appears (e.g. a Leaflet DOM listener that must be
  // explicitly unbound rather than collected with its container), the entry
  // should bump `pairedOff` and this assertion should be updated in the same
  // PR — never bypass the schema pin to hide the drift.
  it("no L.DomEvent.off call exists in the tree", () => {
    expect(scan(DOM_EVENT_OFF_RE)).toEqual([]);
  });

  it("every allow-list entry pins pairedOff to 0", () => {
    for (const [label, list] of [
      ["BARE_ADD_EVENT_LISTENER", BARE_ADD_EVENT_LISTENER],
      ["L_DOM_EVENT_ON", L_DOM_EVENT_ON],
    ] as const) {
      for (const e of list) {
        expect(e.pairedOff, `${label}.${e.f}`).toBe(0);
      }
    }
  });

  it("the checker flags a nonzero pairedOff", () => {
    const problems = checkListenerRegistrations(
      "bare addEventListener",
      [{ f: "Hypothetical.ts", n: 1 }],
      [{ f: "Hypothetical.ts", n: 1, pairedOff: 1, reason: "test" }],
    );
    expect(problems).toEqual([
      "Hypothetical.ts: allow-list pins pairedOff=1 — today's schema requires " +
        "0 (no paired-off removals exist in the tree). Bump the tree-level " +
        "L.DomEvent.off counter-proof at the same time.",
    ]);
  });
});

describe("the listener allow-list guard still bites", () => {
  // Counter-proof. Without these the two scans above would keep passing after
  // the regex stopped matching anything, after the allow-list became a free
  // pass for every file, or after the checker itself went decorative. They
  // feed checkListenerRegistrations synthetic input — not a copy of the scan — so a
  // regression in the decision logic is what they catch.
  it("flags a call no allow-list entry pins", () => {
    const problems = checkListenerRegistrations(
      "bare addEventListener",
      [{ f: "NewControl/ui.ts", n: 1 }],
      [],
    );
    expect(problems).toEqual([
      "NewControl/ui.ts: 1 bare addEventListener call(s) — not on the " +
        "allow-list; route it through the tracked entry or add an entry with the reason",
    ]);
  });

  it("flags a count drift on a pinned file", () => {
    const problems = checkListenerRegistrations(
      "bare addEventListener",
      [{ f: "BaseControl.ts", n: 2 }],
      [{ f: "BaseControl.ts", n: 1, pairedOff: 0, reason: "test" }],
    );
    expect(problems).toEqual([
      "BaseControl.ts: 2 bare addEventListener call(s), allow-list pins 1 " +
        "— a new one crept in, or the file was already migrated (drop the entry)",
    ]);
  });

  it("flags a stale entry for a file that is fully migrated", () => {
    const problems = checkListenerRegistrations(
      "bare addEventListener",
      [],
      [{ f: "GoneControl/ui.ts", n: 3, pairedOff: 0, reason: "test" }],
    );
    expect(problems).toEqual([
      "GoneControl/ui.ts: allow-list entry (n=3) but the scan found no " +
        "bare addEventListener call — the entry is stale, remove it",
    ]);
  });

  it("flags a duplicate allow-list entry instead of silently overwriting it", () => {
    // A duplicate key used to be a Map overwrite: "duplicate + wrong count"
    // passed undetected, and the surviving entry was whichever came last.
    const problems = checkListenerRegistrations(
      "L.DomEvent.on",
      [{ f: "common/panel.ts", n: 3 }],
      [
        { f: "common/panel.ts", n: 3, pairedOff: 0, reason: "test" },
        { f: "common/panel.ts", n: 1, pairedOff: 0, reason: "test" },
      ],
    );
    expect(problems).toEqual([
      "common/panel.ts: duplicate allow-list entry — first pins n=3, this one says n=1",
    ]);
  });

  it("both real allow-lists are free of duplicate keys", () => {
    for (const [label, list] of [
      ["BARE_ADD_EVENT_LISTENER", BARE_ADD_EVENT_LISTENER],
      ["L_DOM_EVENT_ON", L_DOM_EVENT_ON],
      ["MAP_ON_ALLOW_LISTENER", MAP_ON_ALLOW_LISTENER],
    ] as const) {
      const files = list.map(e => e.f);
      expect(new Set(files).size, label).toBe(files.length);
    }
  });

  it("the regexes match what they claim and nothing else", () => {
    expect(callsIn("target.addEventListener('click', fn)", BARE_RE)).toBe(1);
    expect(callsIn("target.addEventListener ('click', fn)", BARE_RE)).toBe(1);
    expect(callsIn("// fake.addEventListener('click')", BARE_RE)).toBe(0);
    expect(callsIn("/* x */ target.addEventListener('click', fn)", BARE_RE)).toBe(1);
    // `removeEventListener(` is not a registration.
    expect(callsIn("target.removeEventListener('click', fn)", BARE_RE)).toBe(0);
    // String-aware: `//` inside a URL is not a comment start.
    expect(
      callsIn('const u = "https://x"; target.addEventListener("click", fn)', BARE_RE),
    ).toBe(1);
    // `//` inside a regex literal is not a comment start.
    expect(
      callsIn('/\\/\\/x/.test(s); target.addEventListener("click", fn)', BARE_RE),
    ).toBe(1);

    expect(callsIn('L.DomEvent.on(btn, "click", fn)', DOM_EVENT_ON_RE)).toBe(1);
    expect(callsIn("L.DomEvent.on (btn, 'click', fn)", DOM_EVENT_ON_RE)).toBe(1);
    expect(callsIn("// L.DomEvent.on(btn, 'click', fn)", DOM_EVENT_ON_RE)).toBe(0);
    // The rest of the Leaflet DOM surface is not a registration.
    expect(callsIn("L.DomEvent.off(btn, 'click', fn)", DOM_EVENT_ON_RE)).toBe(0);
    expect(callsIn("L.DomEvent.stop(event)", DOM_EVENT_ON_RE)).toBe(0);
    expect(callsIn("L.DomEvent.disableClickPropagation(el)", DOM_EVENT_ON_RE)).toBe(0);
    // `.once` is the auto-removing variant, excluded on purpose.
    expect(callsIn("L.DomEvent.once(btn, 'click', fn)", DOM_EVENT_ON_RE)).toBe(0);

    expect(callsIn('map.on("click", fn)', MAP_ON_RE)).toBe(1);
    expect(callsIn("map.on ('click', fn)", MAP_ON_RE)).toBe(1);
    expect(callsIn("// map.on('click', fn)", MAP_ON_RE)).toBe(0);
    // `map.off(` is not a registration; `this.map.on(` is owned by a control
    // instance and is out of scope for this guard.
    expect(callsIn("map.off('click', fn)", MAP_ON_RE)).toBe(0);
    expect(callsIn("this.map.on('click', fn)", MAP_ON_RE)).toBe(0);
    expect(callsIn("ui.m.map.on('click', fn)", MAP_ON_RE)).toBe(0);
  });
});
