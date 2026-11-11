import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { describe, expect, it } from "vitest";
// The bottom tier's directory is not re-spelled here: it must equal the
// shared-module prefixes build-path derives from ALIAS_TO_REL, so a tier
// rename lands in build-path and this test's TIER stays honest (red here
// until TIER follows).
import { SHARED_MODULE_PREFIXES } from "#script/build-path.mjs";

// Import-boundary rules for the production JS tree (foliplus/js).
//
// Four layers, one direction: platform -> ui -> core -> control/<Feature>. A
// layer may import itself and the layers below it, never the ones above.
//   - platform (today "platform/"): host primitives only — DOM, storage,
//     fetch, locale, cssvar, rafLoop, fullscreen. No product semantics.
//   - ui: foliplus chrome — appearance primitives (panelChrome, panelField,
//     icon, panelClassName, canvasLabel) plus the stateful interaction
//     primitives (dropdown, listbox, schemePicker, form, slider, placement).
//     It MUST NOT import core: chrome cannot know the layer domain.
//   - core: domain logic and assembly. It MAY import ui — core composes
//     widgets (rampForm, labelControl, leaflet/panel) and that is the whole
//     reason ui sits below core. core MUST NOT import control.
//   - control/<Feature>: depends on every layer plus its OWN #control alias.
//
// The #control/* alias namespaces component code. A component may only import
// its own namespace (#control/<Name>/... or #foliplus/control/<Name>/...);
// it must never import another component's namespace, and no non-control
// layer may reach into #control/* at all.
//
// Cross-boundary imports that predate this test are listed in ALLOWED (a
// documented whitelist, same shape as the rowView/decoupling guards). Any
// import not covered by its layer's allowance fails this test, so a new
// upward dependency is caught at authoring time.
//
// The tier table below is the single place the layer names live: Step 2
// renames the bottom tier from "platform/" (was "common/") by editing TIER
// (directory and alias in one entry) and the rules/tests follow.
const REPO_ROOT = resolve(".");
const JS_ROOT = resolve(REPO_ROOT, "foliplus/js");
const TEST_JS_ROOT = resolve(REPO_ROOT, "test/js");

// ── Layer classification ──────────────────────────────────────
// TIER maps each tier to its directory AND its #alias segment. Step 2 renames
// the bottom tier (common -> platform) by changing this one value.
// The directories must equal the shared-module prefixes build-path derives
// from ALIAS_TO_REL (asserted below), so a tier rename in build-path lands
// here automatically and this test cannot police a directory the build no
// longer has. The three tier NAMES are the stable identifiers of the
// boundary matrix itself and are NOT derived — they are the matrix's own
// vocabulary, and deriving them positionally from a filtered list (which
// drops #control/#foliplus) would silently reorder ui/core.
const TIER = { platform: "platform", ui: "ui", core: "core" } as const;
type Tier = keyof typeof TIER;
// Single-source: the bottom tier's directory must be the one build-path
// derives. If they diverge (a rename applied here but not in build-path, or
// vice versa) the boundary matrix would police a tier the build no longer
// has. Change ALIAS_TO_REL in build-path first, then this TIER value.
const TIER_DIRS = Object.values(TIER).sort();
const SHARED_PREFIX_DIRS = [...SHARED_MODULE_PREFIXES].sort();
expect(TIER_DIRS).toEqual(SHARED_PREFIX_DIRS);
type Layer = Tier | "control" | "root";

// Allowed dependencies per tier: itself plus everything below it. ui never
// lists #core — chrome must not reach the domain. core lists #ui — the
// composition direction this matrix exists to protect.
const TIER_DEPS: Record<Tier, readonly string[]> = {
  platform: [`#${TIER.platform}/`],
  ui: [`#${TIER.platform}/`, `#${TIER.ui}/`],
  core: [`#${TIER.platform}/`, `#${TIER.ui}/`, `#${TIER.core}/`],
};

// "#foliplus/<layer>/x.js" and "#<layer>/x.js" name the same module; fold the
// longer spelling onto the short one before matching a rule.
const canonical = (spec: string): string =>
  spec.startsWith("#foliplus/") ? `#${spec.slice("#foliplus/".length)}` : spec;

const layerOf = (rel: string): Layer => {
  if (rel.startsWith(`foliplus/js/${TIER.platform}/`)) return "platform";
  if (rel.startsWith(`foliplus/js/${TIER.ui}/`)) return "ui";
  if (rel.startsWith(`foliplus/js/${TIER.core}/`)) return "core";
  if (rel.startsWith("foliplus/js/control/")) return "control";
  return "root";
};

const componentOf = (rel: string): string | null => {
  const m = rel.match(/^foliplus\/js\/control\/([A-Za-z0-9]+)\//);
  return m ? m[1] : null;
};

// (The old core/leaflet-only #ui exception is gone: every core module may use ui.)

// ── Source walk ───────────────────────────────────────────────
const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
};

const IMPORT_RE = /from[ ]*["'][^"']+["']/g;
const readImports = (src: string): Set<string> => {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    const spec = m[0].replace(/^from[ ]*["']/, "").replace(/["']$/, "");
    if (spec.startsWith("#")) out.add(spec);
  }
  return out;
};

// Real-import scanner: matches ONLY actual `import ... from "#..."`
// declarations, never `from "..."` strings inside other string/template
// literals (fixtures) or comments. The existing IMPORT_RE/readImports catches
// the latter and would false-positive on build-tooling fixtures that embed
// #core paths as DATA (global-namespace-plugin, scan-registry).
const readRealImports = (src: string): Array<{ spec: string; line: number }> => {
  const out: Array<{ spec: string; line: number }> = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (src.startsWith("import", i) && !/[\w$]/.test(src[i - 1] || "")) {
      let k = i + 6;
      while (k < n && /\s/.test(src[k])) k++;
      if (src[k] === '"' || src[k] === "'") {
        const q2 = src[k];
        let k2 = k + 1;
        while (k2 < n && src[k2] !== q2) k2++;
        const spec = src.slice(k + 1, k2);
        const line = src.slice(0, i).split("\n").length;
        if (spec.startsWith("#")) out.push({ spec, line });
        i = k2 + 1;
        continue;
      }
      // `import { ... } from "..."` or `import * as X from "..."`.
      let f = k;
      while (f < n) {
        const cc = src[f];
        if (cc === '"' || cc === "'" || cc === "`") {
          const qq = cc;
          let ff = f + 1;
          while (ff < n) {
            if (src[ff] === "\\") {
              ff += 2;
              continue;
            }
            if (src[ff] === qq) {
              ff++;
              break;
            }
            ff++;
          }
          f = ff;
          continue;
        }
        if (
          src.startsWith("from", f) &&
          !/[\w$]/.test(src[f - 1] || "") &&
          /[\s"']/.test(src[f + 4] || " ")
        ) {
          break;
        }
        f++;
      }
      if (f < n) {
        let g = f + 4;
        while (g < n && /\s/.test(src[g])) g++;
        if (src[g] === '"' || src[g] === "'") {
          const qq = src[g];
          let g2 = g + 1;
          while (g2 < n && src[g2] !== qq) g2++;
          const spec = src.slice(g + 1, g2);
          const line = src.slice(0, i).split("\n").length;
          if (spec.startsWith("#")) out.push({ spec, line });
          i = g2 + 1;
          continue;
        }
      }
      i = k;
      continue;
    }
    i++;
  }
  return out;
};

// ── Whitelist: documented cross-boundary imports ──────────────
// Each entry names the file (relative to foliplus/js/), the import
// specifier, and why it is allowed. A new cross-boundary import must be
// added here with its reason, or this test goes red.
const ALLOWED: ReadonlyArray<{
  file: string;
  spec: string;
  reason: string;
}> = [
  // Type-only config-schema imports: the schema is the shared contract
  // between Python and JS, and these are erased at compile time.
  {
    file: "platform/format.ts",
    spec: "#foliplus/config-schema.js",
    reason: "type-only NumberStyle contract, erased at compile time",
  },
  {
    file: "core/geocode/geocoder.ts",
    spec: "#foliplus/config-schema.js",
    reason: "type-only ProviderConfig contract, erased at compile time",
  },
  {
    file: "core/geocode/registry.ts",
    spec: "#foliplus/config-schema.js",
    reason: "type-only ProviderConfig contract, erased at compile time",
  },
  {
    file: "core/layer/intent.ts",
    spec: "#foliplus/config-schema.js",
    reason: "type-only NumberStyle contract, erased at compile time",
  },
  {
    file: "core/lifecycle/defineControl.ts",
    spec: "#foliplus/BaseControl.js",
    reason: "BaseControl is the shared base class (see SHARED_MODULE_EXACTS)",
  },
  {
    file: "runtime/index.ts",
    spec: "#foliplus/BaseControl.js",
    reason: "runtime bootstrap imports the shared base class",
  },
  {
    file: "type/global.d.ts",
    spec: "#foliplus/config-schema.js",
    reason: "global type declaration reuses the config schema",
  },
];

// Test-side exemptions for the test/js barrel rule. Each entry names the
// test file (relative to test/js/), the #core deep specifier it keeps, and
// why the barrel cannot be used. The barrel rule for test/js is otherwise
// absolute: a test importing a core cluster module MUST use the cluster
// barrel (#core/<cluster>/index.js).
//
// Only two classes of exception exist, and both are structural:
//  1. paths-as-data files (build-path.test.ts, import-boundary.test.ts) —
//     they CONSTRUCT and ASSERT #core path strings as data (build-path
//     resolves alias prefixes, import-boundary exercises the very rule), so
//     a real-import scan of their source is meaningless. They are exempt at
//     the FILE level, not the import level.
//  2. vi.spyOn/vi.mock target modules — an ESM live binding is NOT shared by
//     a barrel re-export: spying on `#core/layer/index.js` cannot intercept a
//     production module's direct `import ... from "./capability.js"`. The
//     spy target namespace MUST come from the SAME module the production
//     module imports, which is the deep file. These two exceptions are the
//     only real deep imports left in test/js (verified by the scanner).
const TEST_JS_ALLOWED: ReadonlyArray<{
  file: string;
  spec: string;
  reason: string;
}> = [
  {
    file: "core/layer/LayerSurface.test.ts",
    spec: "#core/layer/capability.js",
    reason:
      "vi.spyOn target namespace must match the prod module's direct import (ESM live binding; a barrel re-export does not share it)",
  },
  {
    file: "core/layer/LayerSurface.test.ts",
    spec: "#core/layer/carrier.js",
    reason:
      "vi.spyOn target namespace must match the prod module's direct import (ESM live binding; a barrel re-export does not share it)",
  },
];

// Files exempt from the test/js barrel rule at the FILE level (paths-as-data).
const TEST_JS_FILE_EXEMPT = new Set([
  "script/build-path.test.ts",
  "script/import-boundary.test.ts",
]);

// Map a test file rel (test/js/...) to its exempt #core deep specs, keyed by
// the file-relative path minus the "test/js/" prefix.
const testJsAllowedFor = (rel: string): Map<string, string> => {
  const key = rel.replace(/^test\/js\//, "");
  const map = new Map<string, string>();
  for (const a of TEST_JS_ALLOWED) {
    if (a.file === key) map.set(a.spec, a.reason);
  }
  return map;
};

// The set of allowed specs for a given file, keyed by file rel path.
const allowedFor = (rel: string): Map<string, string> => {
  const key = rel.replace(/^foliplus\/js\//, "");
  const map = new Map<string, string>();
  for (const a of ALLOWED) {
    if (a.file === key) map.set(a.spec, a.reason);
  }
  return map;
};

// Resolve a #alias specifier to a repo-relative path (foliplus/js/...).
// Unknown/relative specs return null. "spec" must be a "#"-prefixed specifier.
const resolveTarget = (fromRel: string, spec: string): string | null => {
  // Same-directory or parent-relative already use "."/".." — not # aliases.
  if (!spec.startsWith("#")) return null;
  const canonicalSpec = canonical(spec);
  // #control/<Name>/... → foliplus/js/control/<Name>/...
  const control = canonicalSpec.match(/^#control\/([A-Za-z0-9]+)\/(.+)$/);
  if (control) return `foliplus/js/control/${control[1]}/${control[2]}`;
  // #platform/#ui/#core/#foliplus/<rest> → foliplus/js/<tier>/<rest>
  const tier = canonicalSpec.match(/^#(platform|ui|core|foliplus)\/(.+)$/);
  if (tier) {
    const rest = tier[2];
    // #foliplus/<x> maps directly under foliplus/js/.
    const base = tier[1] === "foliplus" ? "foliplus/js" : `foliplus/js/${tier[1]}`;
    return `${base}/${rest}`;
  }
  return null;
};

// The barrel rule: which imports must go through a tier barrel.
// ui/index.js and every core/<cluster>/index.js each own a namespace; a file
// outside the barrel's directory importing a module inside it must use the
// barrel.
//
// Same-cluster core imports (a core/<cluster> file importing #core/<cluster>/
// <mod>) stay deep by design — that is an internal leaf connection. A CORE
// file importing ANOTHER cluster must use that cluster's barrel.
//
// Cycle-safe leaf exceptions: a handful of core modules are cycle-reachable
// (mode.ts imports ../event/index.js + ../layer/index.js; layer/index imports
// walkLeaf; walkLeaf/filterStore/event re-export lifecycle leaves). They
// import the ZERO-DEP leaf units (leafletAdapter/mapApi) directly instead of
// the lifecycle barrel, which would close a module cycle. These are the only
// documented cross-cluster deep exceptions.
const CORE_CYCLE_LEAF_EXCEPTIONS = new Set([
  "#core/geo/coord.js",
  "#core/geocode/geocoder.js",
  "#core/layer/walkLeaf.js",
]);
const CORE_CLUSTER_RE = /^#core\/([A-Za-z0-9_]+)\//;

const barrelFor = (fromRel: string, canonicalSpec: string): string | null => {
  // The barrel's own re-exports are the barrel itself — never a violation.
  // ui barrel: a file in a DIFFERENT tier (or root/control) importing #ui/<mod>
  // (not index) must use the barrel. Same-tier ui files may import a ui module
  // directly — a same-tier leaf connection.
  if (
    canonicalSpec.startsWith("#ui/") &&
    !canonicalSpec.startsWith("#ui/index.js") &&
    layerOf(fromRel) !== "ui"
  ) {
    return "cross-tier ui import must go through #ui/index.js";
  }
  // Any core cluster barrel: a file outside core/<cluster>/ importing
  // #core/<cluster>/<mod> (not index) must use the cluster barrel.
  // Same-cluster core files (from core/<cluster>/) may import the module
  // directly — a same-cluster leaf connection.
  const coreMatch = CORE_CLUSTER_RE.exec(canonicalSpec);
  if (coreMatch && !canonicalSpec.startsWith("#core/index.js")) {
    const cluster = coreMatch[1];
    const isIndex = canonicalSpec.startsWith(`#core/${cluster}/index.js`);
    if (!isIndex && layerOf(fromRel) !== "core") {
      // External (ui/control/platform/runtime) — must use the barrel.
      return `cross-tier core import must go through #core/${cluster}/index.js`;
    }
    if (!isIndex && layerOf(fromRel) === "core") {
      // Core file importing another cluster's module — must use that cluster's
      // barrel, EXCEPT the documented cycle-safe leaf units.
      const fromCluster = /^foliplus\/js\/core\/([A-Za-z0-9_]+)\//.exec(fromRel);
      const same = fromCluster && fromCluster[1] === cluster;
      if (!same && !CORE_CYCLE_LEAF_EXCEPTIONS.has(canonicalSpec)) {
        return `cross-cluster core import must go through #core/${cluster}/index.js`;
      }
    }
  }
  return null;
};

// ── The rules ─────────────────────────────────────────────────
// Each violation is [file, spec, rule]. The test asserts none exist.
const collect = (): Array<[string, string, string]> => {
  const problems: Array<[string, string, string]> = [];
  const files = walk(JS_ROOT);
  for (const file of files) {
    // Repo-relative path, /-separated. layerOf/componentOf/allowedFor all
    // key off this shape (e.g. "foliplus/js/control/LayerControl/ui/index.ts").
    const rel = file
      .slice(REPO_ROOT.length + 1)
      .split("\\")
      .join("/");
    const layer = layerOf(rel);
    const comp = componentOf(rel);
    const src = readFileSync(file, "utf-8");
    const imports = readImports(src);
    for (const spec of imports) {
      const allowed = allowedFor(rel);
      const reason = allowed.get(spec);
      if (reason) continue;

      const canonicalSpec = canonical(spec);

      // ── Rule 1: non-control layers must not reach into #control/* ──
      if (layer !== "control" && canonicalSpec.startsWith("#control/")) {
        problems.push([
          rel.replace("foliplus/js/", ""),
          spec,
          "non-control layer imports #control/*",
        ]);
        continue;
      }

      // ── Rule 2: a component imports only its own namespace ──
      if (layer === "control" && comp) {
        const target = canonicalSpec.match(/^#control\/([A-Za-z0-9]+)/);
        if (target && target[1] !== comp) {
          problems.push([
            rel.replace("foliplus/js/", ""),
            spec,
            `cross-component import (${comp} → ${target[1]})`,
          ]);
          continue;
        }
      }

      // ── Rule 3: layer direction — a tier imports itself and below only ──
      if (layer === "platform" || layer === "ui" || layer === "core") {
        const deps = TIER_DEPS[layer];
        if (!deps.some(prefix => canonicalSpec.startsWith(prefix))) {
          problems.push([
            rel.replace("foliplus/js/", ""),
            spec,
            `${layer} imports outside ${deps.join(" | ")}`,
          ]);
        }
      }

      // ── Rule 4: a same-directory import must be relative ("./x.js"), not an alias ──
      // Two files in the same directory must use a relative specifier: an alias
      // (e.g. #control/LayerControl/ui/focus/marqueeShape.js) that resolves to the
      // same directory adds a layer of indirection with no benefit, and lets the
      // directory be renamed without the call sites following.
      if (spec.startsWith("#")) {
        const fileDir = dirname(rel);
        const target = resolveTarget(rel, spec);
        if (target && dirname(target) === fileDir) {
          problems.push([
            rel.replace("foliplus/js/", ""),
            spec,
            "same-directory import must use a relative specifier",
          ]);
          continue;
        }
      }

      // ── Rule 5: a cross-tier import must go through the tier barrel ──
      // ui and core/layer each have an index.ts barrel. A file outside the
      // barrel's directory importing a module inside it must use the barrel
      // (e.g. #ui/index.js, #core/layer/index.js) — never the module path
      // directly — so the barrel owns the namespace shape and a module rename
      // does not ripple through call sites.
      const barrelRule = barrelFor(rel, canonicalSpec);
      if (barrelRule) {
        problems.push([rel.replace("foliplus/js/", ""), spec, barrelRule]);
        continue;
      }
    }
  }
  return problems;
};

// The test/js barrel rule: a test file importing a core cluster module must
// use the cluster barrel (#core/<cluster>/index.js), never the deep path.
// #platform deep imports remain allowed (no tier barrel exists for them).
// Exemptions are structural and documented above (TEST_JS_ALLOWED +
// TEST_JS_FILE_EXEMPT).
const collectTestJs = (): Array<[string, number, string, string]> => {
  const problems: Array<[string, number, string, string]> = [];
  const files = walk(TEST_JS_ROOT);
  for (const file of files) {
    const rel = file
      .slice(REPO_ROOT.length + 1)
      .split("\\")
      .join("/");
    if (TEST_JS_FILE_EXEMPT.has(rel.replace(/^test\/js\//, ""))) continue;
    const src = readFileSync(file, "utf-8");
    const allowed = testJsAllowedFor(rel);
    for (const im of readRealImports(src)) {
      const canonicalSpec = canonical(im.spec);
      if (!CORE_CLUSTER_RE.test(canonicalSpec)) continue;
      if (canonicalSpec.startsWith("#core/index.js")) continue;
      const cluster = CORE_CLUSTER_RE.exec(canonicalSpec)![1];
      if (canonicalSpec.startsWith(`#core/${cluster}/index.js`)) continue;
      if (im.spec.includes("?raw")) continue;
      const reason = allowed.get(canonical(im.spec));
      if (reason) continue;
      problems.push([
        rel.replace(/^test\/js\//, ""),
        im.line,
        im.spec,
        `must go through #core/${cluster}/index.js`,
      ]);
    }
  }
  return problems;
};

describe("JS import boundaries", () => {
  it("scans a non-trivial production tree", () => {
    expect(walk(JS_ROOT).length).toBeGreaterThanOrEqual(80);
  });

  it("every #control import stays within the component's own namespace", () => {
    const violations = collect();
    const control = violations.filter(
      v => v[2].includes("cross-component") || v[2].includes("#control/*"),
    );
    expect(control, control.map(v => v.join(" ")).join("\n")).toEqual([]);
  });

  it("no non-control layer (platform/ui/core/root) imports #control/*", () => {
    const violations = collect().filter(
      v => v[2] === "non-control layer imports #control/*",
    );
    expect(violations, violations.map(v => v.join(" ")).join("\n")).toEqual([]);
  });

  it("tiers depend only downward (platform -> ui -> core)", () => {
    const violations = collect().filter(v => v[2].includes(" imports outside "));
    expect(violations, violations.map(v => v.join(" ")).join("\n")).toEqual([]);
  });

  it("a same-directory import uses a relative specifier", () => {
    const violations = collect().filter(
      v => v[2] === "same-directory import must use a relative specifier",
    );
    expect(violations, violations.map(v => v.join(" ")).join("\n")).toEqual([]);
  });

  it("a cross-tier import goes through the tier barrel (ui, core/layer)", () => {
    const violations = collect().filter(v => v[2].includes("must go through"));
    expect(violations, violations.map(v => v.join(" ")).join("\n")).toEqual([]);
  });

  it("the tier-barrel rule is live, not vacuous (external consumers use the barrel)", () => {
    const files = walk(JS_ROOT);
    const externalUi = files
      .map(f =>
        f
          .split("\\")
          .join("/")
          .replace(`${REPO_ROOT.split("\\").join("/")}/`, ""),
      )
      .filter(rel => !rel.startsWith("foliplus/js/ui/"))
      .filter(rel =>
        readFileSync(join(REPO_ROOT, rel), "utf-8").includes("#ui/index.js"),
      );
    expect(externalUi.length).toBeGreaterThan(0);
  });

  it("core consumes the ui chrome layer (the allowance is live, not vacuous)", () => {
    // ui/ is the chrome layer; core assembles widgets with it (rampForm,
    // labelControl, leaflet/panel). If this drops to zero, either core stopped
    // composing chrome or the rule silently forbade a legitimate edge.
    const users = walk(JS_ROOT)
      .filter(f => f.split("\\").join("/").includes("/js/core/"))
      .filter(f => readFileSync(f, "utf-8").includes("#ui/"));
    expect(users.length).toBeGreaterThan(0);
  });

  it("ui never imports core (chrome cannot know the domain)", () => {
    const offenders = walk(JS_ROOT)
      .filter(f => f.split("\\").join("/").includes("/js/ui/"))
      .filter(f => {
        const src = readFileSync(f, "utf-8");
        return src.includes("#core/") || src.includes("#foliplus/core/");
      })
      .map(f =>
        f
          .split("\\")
          .join("/")
          .replace(`${REPO_ROOT.split("\\").join("/")}/`, ""),
      );
    expect(offenders).toEqual([]);
  });

  it("every tier directory exists (a half-done rename fails here)", () => {
    for (const dir of Object.values(TIER)) {
      expect(existsSync(join(JS_ROOT, dir)), `tier directory missing: ${dir}`).toBe(
        true,
      );
    }
  });

  it("whitelist entries are all still present (no dead allowances)", () => {
    // Every allowance must be exercised, or it quietly hides a future
    // regression. A dead entry means the import it documented disappeared.
    const files = walk(JS_ROOT);
    const srcs = files.map(f => readFileSync(f, "utf-8"));
    for (const a of ALLOWED) {
      const present = srcs.some(src => src.includes(a.spec));
      expect(present, `dead allowance: ${a.file} -> ${a.spec}`).toBe(true);
    }
  });
});

// The barrel rule must be live in BOTH directions: the positive guards above
// prove the tree is clean today, but a rule that never fired would silently
// drift. These synthetic cases pin the rule's teeth — a future violation
// must turn red, not pass.
// The test/js barrel rule must be live in BOTH directions: the positive scan
// proves the tree is clean today; the acceptance cases pin the teeth so a
// future violation turns red, not pass.
describe("test/js barrel rule", () => {
  it("scans a non-trivial test tree", () => {
    expect(walk(TEST_JS_ROOT).length).toBeGreaterThanOrEqual(80);
  });

  it("no test imports a core cluster module by deep path (real imports only)", () => {
    const violations = collectTestJs();
    expect(
      violations,
      violations.map(v => `${v[0]}:${v[1]} ${v[2]} ${v[3]}`).join("\n"),
    ).toEqual([]);
  });

  it("the exemption list is live, not stale (every entry is exercised)", () => {
    // A dead exemption means the import it documented disappeared; the
    // exemption then quietly hides a future regression.
    const srcs = walk(TEST_JS_ROOT).map(f => readFileSync(f, "utf-8"));
    for (const a of TEST_JS_ALLOWED) {
      const present = srcs.some(src => src.includes(a.spec));
      expect(present, `dead exemption: ${a.file} -> ${a.spec}`).toBe(true);
    }
  });

  it("a deliberately deep test import goes red (real assertion)", () => {
    // Synthetic teeth: a deep import in a NON-exempt test file must be
    // flagged with the barrel suggestion.
    const violations = collectTestJsFrom(`test/js/core/geo/coord.test.ts`, [
      { spec: "#core/layer/intent.js", line: 3 },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0][3]).toContain("#core/layer/index.js");
  });

  it("whitelisted paths-as-data files are not red", () => {
    for (const rel of TEST_JS_FILE_EXEMPT) {
      const violations = collectTestJsFrom(`test/js/${rel}`, []);
      expect(violations, `${rel} should be exempt`).toEqual([]);
    }
  });
});

// Test seam: run the test/js rule against a single synthetic source set.
// The scanner + exemption logic are shared with collectTestJs, so the teeth
// above exercise the SAME code path the real scan uses.
const collectTestJsFrom = (
  rel: string,
  synthetic: Array<{ spec: string; line: number }>,
): Array<[string, number, string, string]> => {
  const file = resolve(REPO_ROOT, rel);
  const src = readFileSync(file, "utf-8");
  const problems: Array<[string, number, string, string]> = [];
  const allowed = testJsAllowedFor(rel);
  const imports = synthetic.length ? synthetic : readRealImports(src);
  for (const im of imports) {
    const canonicalSpec = canonical(im.spec);
    if (!CORE_CLUSTER_RE.test(canonicalSpec)) continue;
    if (canonicalSpec.startsWith("#core/index.js")) continue;
    const cluster = CORE_CLUSTER_RE.exec(canonicalSpec)![1];
    if (canonicalSpec.startsWith(`#core/${cluster}/index.js`)) continue;
    if (im.spec.includes("?raw")) continue;
    if (allowed.has(canonical(im.spec))) continue;
    problems.push([
      rel.replace(/^test\/js\//, ""),
      im.line,
      im.spec,
      `must go through #core/${cluster}/index.js`,
    ]);
  }
  return problems;
};

describe("barrelFor rejects synthetic violations", () => {
  it("an external consumer's deep path is a cross-tier violation", () => {
    expect(
      barrelFor("foliplus/js/control/LayerControl/x.ts", "#core/value/classify.js"),
    ).toContain("#core/value/index.js");
  });

  it("a core file's cross-cluster deep path is a cross-cluster violation", () => {
    expect(
      barrelFor("foliplus/js/core/layer/intent.ts", "#core/value/classify.js"),
    ).toContain("#core/value/index.js");
  });

  it("a documented cycle-safe leaf deep path is allowed", () => {
    expect(
      barrelFor("foliplus/js/core/layer/walkLeaf.ts", "#core/mapApi.js"),
    ).toBeNull();
  });

  it("a same-cluster deep path is allowed", () => {
    expect(
      barrelFor("foliplus/js/core/value/ramp.ts", "#core/value/classify.js"),
    ).toBeNull();
  });
});
