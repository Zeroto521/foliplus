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
// ui/index.js and core/layer/index.js each own a namespace; a file outside the
// barrel's directory importing a module inside it must use the barrel.
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
  // core/layer barrel: any file outside foliplus/js/core/layer/ importing
  // #core/layer/<mod> (not index).
  if (
    canonicalSpec.startsWith("#core/layer/") &&
    !canonicalSpec.startsWith("#core/layer/index.js") &&
    layerOf(fromRel) !== "core"
  ) {
    return "cross-tier core/layer import must go through #core/layer/index.js";
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
