import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";

// Import-boundary rules for the production JS tree (foliplus/js).
//
// Four layers, one direction: platform -> ui -> core -> control/<Feature>. A
// layer may import itself and the layers below it, never the ones above.
//   - platform (today "common/"): host primitives only — DOM, storage,
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
// renames the bottom tier from "common/" to "platform/" by editing TIER
// (directory and alias in one entry) and the rules/tests follow.
const REPO_ROOT = resolve(".");
const JS_ROOT = resolve(REPO_ROOT, "foliplus/js");

// ── Layer classification ──────────────────────────────────────
// TIER maps each tier to its directory AND its #alias segment. Step 2 renames
// the bottom tier (common -> platform) by changing this one value.
const TIER = { platform: "common", ui: "ui", core: "core" } as const;
type Tier = keyof typeof TIER;
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
  spec.startsWith("#foliplus/") ? "#" + spec.slice("#foliplus/".length) : spec;

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
    file: "common/format.ts",
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
    file: "core/defineControl.ts",
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
            layer + " imports outside " + deps.join(" | "),
          ]);
        }
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

  it("no non-control layer (common/ui/core/root) imports #control/*", () => {
    const violations = collect().filter(
      v => v[2] === "non-control layer imports #control/*",
    );
    expect(violations, violations.map(v => v.join(" ")).join("\n")).toEqual([]);
  });

  it("tiers depend only downward (platform -> ui -> core)", () => {
    const violations = collect().filter(v => v[2].includes(" imports outside "));
    expect(violations, violations.map(v => v.join(" ")).join("\n")).toEqual([]);
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
          .replace(REPO_ROOT.split("\\").join("/") + "/", ""),
      );
    expect(offenders).toEqual([]);
  });

  it("every tier directory exists (a half-done rename fails here)", () => {
    for (const dir of Object.values(TIER)) {
      expect(existsSync(join(JS_ROOT, dir)), "tier directory missing: " + dir).toBe(
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
