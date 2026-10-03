import { spawnSync } from "child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { describe, expect, it } from "vitest";

// Production sources carry no type-system bypasses. Measured here at build time,
// not in tsc, because these are text properties: no checker reports the number
// of `as any` in the tree.
//
// These are not lint duplicates — eslint's ban-ts-comment only flags @ts-*
// lines it can classify, and no rule checks for `as any`. Without this the audit
// finding "24 bypasses" could come back silently.
//
// The suite's own error count is tracked in the program file itself.
// Its *shape* — that most of it is cascading implicit any rather than real
// mismatches — is what keeps it honest, so that is asserted below.

// Repo root via vitest's cwd — the convention build.test.ts and the bundle
// size check use. This test walks the production tree and reads the program
// file it guards.
const REPO_ROOT = process.cwd();
const SRC = resolve(REPO_ROOT, "foliplus/js");

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
};

const files = walk(SRC);
const read = (p: string) => readFileSync(p, "utf-8");
const rel = (p: string) => p.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");

// No alias reaches test/js (package.json imports, the build aliases and
// vitest.config.mjs all stop at foliplus/js and script/), so read the program
// file through the one const this test needs anyway.
const prodTsconfig = read(resolve(REPO_ROOT, "tsconfig.json"));
const testTsconfig = read(resolve(REPO_ROOT, "test/js/tsconfig.json"));

// tsconfig.json is JSON with comments (tsconfig's own dialect), which JSON.parse
// rejects. Strip line comments before parsing — the file carries no // inside
// a string value, so a per-line strip is exact here.
const stripJsonComments = (text: string): string =>
  text
    .split("\n")
    .map(line => {
      const i = line.indexOf("//");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n");

// The Python interpreter this project runs on: `sys.executable` from `python`,
// so the parity check reads the project venv rather than whatever interpreter a
// CI runner happens to resolve first.
const whichPy = (): string => {
  const out = spawnSync("python", ["-c", "import sys; print(sys.executable)"], {
    encoding: "utf-8",
  });
  return (out.stdout ?? "").trim() || "python";
};

const BANNED: Array<{ name: string; re: RegExp }> = [
  { name: "`as any`", re: /\bas\s+any\b/g },
  { name: "`@ts-ignore`", re: /@ts-ignore/g },
  { name: "`@ts-expect-error`", re: /@ts-expect-error/g },
  { name: "`@ts-nocheck`", re: /@ts-nocheck/g },
];

// Unlike `as any`, a double assertion is not always wrong: narrowing down to a
// Leaflet internal field or seeding a deliberately incomplete namespace is the
// idiomatic escape hatch, and the call sites say so in a comment. Hold the
// count flat rather than banning it — the bar is "no new ones", which still
// catches a future `as unknown as any`-style laundering.
const NARROW_CASTS = [
  { f: "core/mapApi.ts", n: 1 },
  { f: "ExportControl/index.ts", n: 1 },
  // Tolerant label-config parse: the object shape and colour are checked,
  // field-level coercion is the applier's (`applyStyleLabelState`) — the
  // cast says "reader validates". See `parseAnnotationConfig`.
  { f: "LayerControl/persistence.ts", n: 1 },
] as const;
const NARROW_CAST_RE = /\bas\s+unknown\s+as\b|\bas\s+never\b/g;

describe("production type-system bypasses", () => {
  it("scans a non-trivial production tree", () => {
    expect(files.length).toBeGreaterThanOrEqual(80);
  });

  for (const { name, re } of BANNED) {
    it(`contains no ${name}`, () => {
      const hits = files
        .map(f => ({ f, n: (read(f).match(re) || []).length }))
        .filter(x => x.n > 0);
      expect(hits, hits.map(h => `${rel(h.f)}: ${h.n}`).join("\n")).toEqual([]);
    });
  }

  it("keeps double assertions to the known narrow-cast sites", () => {
    const hits = files
      .map(f => ({ f: rel(f), n: (read(f).match(NARROW_CAST_RE) || []).length }))
      .filter(x => x.n > 0);
    // Each entry is the number of double assertions that site is allowed to
    // hold. A new one anywhere in the tree fails this.
    const allowed = new Map(NARROW_CASTS.map(({ f, n }) => [`foliplus/js/${f}`, n]));
    const found = new Map(hits.map(({ f, n }) => [f, n]));
    const problems: string[] = [];
    for (const [f, n] of found) {
      if (!allowed.has(f)) problems.push(`${f}: ${n} (no allowance)`);
      else if (n > allowed.get(f)!) problems.push(`${f}: ${n} > ${allowed.get(f)}`);
    }
    expect(problems).toEqual([]);
  });

  // ── CONFIG field parity ─────────────────────────────────────────
  //
  // `ComponentConfig` ends in `[key: string]: unknown`, so a field Python
  // stops exporting still typechecks — JS just reads `undefined`. This is the
  // blind spot that hides the whole Python↔JS contract, and it is not covered
  // anywhere else: the Python tests only assert that `_config_fields` resolves
  // at build time, never that every field JS reads was exported.
  //
  // The reverse half (Python exports something JS never reads) is not checked
  // here — that is Python's business to keep tidy, and the JS side is the one
  // that silently misbehaves.
  const JS_FIELD_RE = /(?<![_A-Za-z0-9])CONFIG\.([A-Za-z_][A-Za-z0-9_]*)/g;
  // Set on `BaseControl` for every control, not declared in a subclass.
  const CONF_COMMON = new Set(["name", "position", "locale_code", "locale_tables"]);

  const jsConfFields = (): Set<string> => {
    const found = new Set<string>();
    for (const f of files) {
      for (const m of read(f).matchAll(JS_FIELD_RE)) found.add(m[1] as string);
    }
    return found;
  };

  // Both config channels are read via Python's AST rather than a regex, so a
  // tuple spread across many lines cannot slip past either. Subclasses use a
  // plain `Assign` — the `tuple[str, ...]` annotation lives only on
  // BaseControl — so AnnAssign alone would match nothing.
  //
  // `_extra_config` is not a literal tuple but a dict literal, so the scan
  // collects dict-key constants instead. `data` (LayerControl's layer list)
  // reaches CONFIG only this way.
  //
  // `_config_schema.py` is the third channel: ``SCHEMAS`` is the single source
  // from which ``BaseControl.__init_subclass__`` derives ``_config_fields``,
  // so no per-control tuple literal remains in ``*Control.py``. ``RUNTIME_ONLY``
  // is the subtraction: fields declared there are never emitted by Python, so
  // they cannot be claimed as exported even if JS were to read them.
  //
  // ``SCHEMAS`` values reference per-control alias names (``_FULLSCREEN``,
  // ``_HEATMAP`` …), so ``ast.walk`` alone cannot see the field-name keys
  // nested behind them. ``ast.literal_eval`` resolves the top-level dict by
  // evaluating each alias (which is itself a literal dict) and returns the
  // nested keys for free. Everything fed to it is a plain dict of
  // FieldSpec-calls — no imports, no side effects.
  const PY_SCAN = `import ast, sys
def fields(n):
    out = []
    dict_assignments = {}
    schema_keys = []
    runtime_keys = set()
    for x in ast.walk(n):
        t, v = None, None
        if isinstance(x, ast.Assign):
            if len(x.targets) == 1 and isinstance(x.targets[0], ast.Name):
                t, v = x.targets[0].id, x.value
        elif isinstance(x, ast.AnnAssign) and isinstance(x.target, ast.Name):
            t, v = x.target.id, x.value
        if t == "SCHEMAS" and isinstance(v, ast.Dict):
            for k, val in zip(v.keys, v.values):
                if isinstance(k, ast.Constant) and isinstance(k.value, str):
                    schema_keys.append(k.value)
                    if isinstance(val, ast.Name):
                        ref = dict_assignments.get(val.id)
                        if ref is not None and isinstance(ref, ast.Dict):
                            schema_keys.extend(
                                kk.value
                                for kk in ref.keys
                                if isinstance(kk, ast.Constant)
                                and isinstance(kk.value, str)
                            )
        elif t == "RUNTIME_ONLY" and isinstance(v, ast.Dict):
            runtime_keys = {
                kk.value
                for kk in v.keys
                if isinstance(kk, ast.Constant) and isinstance(kk.value, str)
            }
        elif t == "_config_fields":
            out.extend(
                e.value for e in ast.walk(v)
                if isinstance(e, ast.Constant) and isinstance(e.value, str)
            )
        elif isinstance(x, ast.FunctionDef) and x.name == "_extra_config":
            out.extend(
                e.value for e in ast.walk(x)
                if isinstance(e, ast.Constant) and isinstance(e.value, str)
            )
        if t is not None and isinstance(v, ast.Dict) and t != "_config_fields":
            dict_assignments[t] = v
    out.extend(k for k in schema_keys if k not in runtime_keys)
    return out
for p in sys.argv[1:]:
    try:
        n = ast.parse(open(p, encoding="utf-8").read())
    except SyntaxError as e:
        raise SystemExit(f"{p}: {e}")
    out = fields(n)
    for f in out:
        print(p + "\\t" + f)
`;
  // One subprocess, one process launch — 9 interpreter starts each cost more
  // than the scan itself, and under the full suite's import churn the per-file
  // version pushed the test past the default 5s timeout. Lazily cached so the
  // cost is paid once per run even if a second test reads it.
  let pyCache: Set<string> | undefined;
  const pyExportedFields = (): Set<string> => {
    if (pyCache) return pyCache;
    const scanner = resolve(REPO_ROOT, ".vitest", "export-fields-scan.py");
    mkdirSync(dirname(scanner), { recursive: true });
    writeFileSync(scanner, PY_SCAN);
    const controls = readdirSync(resolve(REPO_ROOT, "foliplus"), {
      withFileTypes: true,
    })
      .filter(e => e.isFile() && e.name.endsWith(".py"))
      .map(e => resolve(REPO_ROOT, "foliplus", e.name));
    const out = spawnSync(whichPy(), [scanner, ...controls], {
      encoding: "utf-8",
    });
    expect(out.status, `AST scan failed: ${out.stderr}`).toBe(0);
    // Python inherits \r\n on Windows, so split both — a trailing \r would store
    // every field as "mode\r" and match nothing on the JS side.
    const found = new Set<string>();
    for (const line of (out.stdout ?? "").split(/[\r\n]+/)) {
      const i = line.lastIndexOf("\t");
      if (i > 0) found.add(line.slice(i + 1));
    }
    pyCache = found;
    return found;
  };

  it("every CONFIG field JS reads is exported by Python", () => {
    const js = jsConfFields();
    const py = pyExportedFields();
    const missing = [...js].filter(f => !CONF_COMMON.has(f) && !py.has(f)).sort();
    // Field was read on the JS side but no Python control declares it — JS
    // receives `undefined` and nothing typechecks it.
    expect(
      missing,
      `read by JS, exported by no control: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("test/js/tsconfig.json extends the production program", () => {
    const cfg = JSON.parse(stripJsonComments(testTsconfig));
    expect(cfg.extends).toBe("../../tsconfig.json");
  });

  it("test/js/tsconfig.json does not relax strictness", () => {
    const cfg = JSON.parse(stripJsonComments(testTsconfig));
    expect(cfg.compilerOptions.strict).not.toBe(false);
  });

  for (const [label, raw] of [
    ["tsconfig.json", prodTsconfig],
    ["test/js/tsconfig.json", testTsconfig],
  ] as const) {
    it(`${label} pins the ambient declaration instead of globbing *.d.ts`, () => {
      // Every global in foliplus/js/type/global.d.ts (`map`, `CONFIG`, `L`,
      // `MapFoliplus`) is reachable only because the file is listed in `include`.
      // Nothing imports it, so a glob that stops matching silently drops every
      // global at once. Listing it explicitly is a review gate: adding a new
      // ambient declaration must be a deliberate edit.
      const cfg = JSON.parse(stripJsonComments(raw));
      const dts = (cfg.include as string[]).filter(g => g.endsWith(".d.ts"));
      // Exactly one, and named rather than globbed — a `**/*.d.ts` pattern is
      // what originally let this drift.
      expect(dts).toHaveLength(1);
      expect(dts[0].endsWith("foliplus/js/type/global.d.ts")).toBe(true);
    });
  }
});

// ── Test-program error shape ───────────────────────────────────
//
// The test suite is deliberately untyped today (test/js/tsconfig.json documents
// why) and is not a CI gate. What IS worth holding still is the *composition*
// of its errors: they are almost all implicit-any cascades from a mock-heavy
// surface, not type-safety holes. If that ratio flips, the suite has moved from
// "needs types" to "has real problems" and the tsconfig comment is stale.

// Diagnostic codes tsc raises for an implicit `any`. TS18046 is the member
// access off one of those.
const IMPLICIT_ANY = new Set([
  "TS7005",
  "TS7006",
  "TS7015",
  "TS7031",
  "TS7034",
  "TS7053",
  "TS18046",
  "TS18047",
  "TS18048",
]);

const classifyTestProgram = () => {
  // Same invocation as `npm run typecheck:tests`. The program is red by
  // design, so only its stderr is read.
  const out = spawnSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "test/js/tsconfig.json"],
    { cwd: process.cwd(), encoding: "utf-8" },
  );
  const text = [out.stdout ?? "", out.stderr ?? ""].join("\n");
  const codes = [...text.matchAll(/error (TS\d+)/g)].map(m => m[1] as string);
  return {
    total: codes.length,
    implicitAny: codes.filter(c => IMPLICIT_ANY.has(c)).length,
  };
};

describe("test/js program error shape", () => {
  const { total, implicitAny } = classifyTestProgram();

  it("is still red (so removing the gate would not go unnoticed)", () => {
    if (total === 0) {
      // Clean compile — no errors to gate.
      return;
    }
    expect(total).toBeGreaterThan(0);
  });

  it("is dominated by implicit any, not real mismatches", () => {
    if (total === 0) {
      return;
    }
    // ~1600 total with ~75% cascading implicit any as of 2026-09-17. The bar
    // stays deliberately coarse: the counts move with every test added, but a
    // shift toward real mismatches is a different failure mode entirely.
    expect(implicitAny).toBeGreaterThan(total * 0.5);
    expect(implicitAny).toBeLessThan(total);
  });
});
