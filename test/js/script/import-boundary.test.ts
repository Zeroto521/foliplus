import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";

// Import-boundary rules for the production JS tree (foliplus/js).
//
// The layer order is common → core → ui → plugin: each layer may depend on
// the layers below it, never the ones above. Concretely:
//   - common: only #common (pure utilities; no DOM/config dependencies)
//   - ui:     only #common + #ui (facade only today; may grow)
//   - core:   #common + #core; core/leaflet may also use #ui
//   - plugin: #common + #core + #ui + its OWN #control/<Name>
//
// The #control/* alias (added in this PR) namespaces component code. A
// component may only import its own namespace (#control/<Name>/... or
// #foliplus/control/<Name>/...); it must never import another component's
// namespace, and no non-plugin layer may reach into #control/* at all.
//
// Cross-boundary imports that predate this test are listed in ALLOWED (a
// documented whitelist, same shape as the rowView/decoupling guards). Any
// import not covered by its layer's allowance fails this test, so a new
// upward dependency is caught at authoring time.
const REPO_ROOT = resolve(".");
const JS_ROOT = resolve(REPO_ROOT, "foliplus/js");

// ── Layer classification ──────────────────────────────────────
type Layer = "common" | "ui" | "core" | "plugin" | "root";

const layerOf = (rel: string): Layer => {
  if (rel.startsWith("foliplus/js/common/")) return "common";
  if (rel.startsWith("foliplus/js/ui/")) return "ui";
  if (rel.startsWith("foliplus/js/core/")) return "core";
  if (rel.startsWith("foliplus/js/control/")) return "plugin";
  return "root";
};

const componentOf = (rel: string): string | null => {
  const m = rel.match(/^foliplus\/js\/control\/([A-Za-z0-9]+)\//);
  return m ? m[1] : null;
};

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

      // ── Rule 1: non-plugin layers must not reach into #control/* ──
      if (layer !== "plugin") {
        if (spec.startsWith("#control/") || spec.startsWith("#foliplus/control/")) {
          problems.push([
            rel.replace("foliplus/js/", ""),
            spec,
            "non-plugin layer imports #control/*",
          ]);
          continue;
        }
      }

      // ── Rule 2: a component imports only its own namespace ──
      if (layer === "plugin" && comp) {
        const target = spec.match(/^#(?:control|foliplus\/control)\/([A-Za-z0-9]+)/);
        if (target && target[1] !== comp) {
          problems.push([
            rel.replace("foliplus/js/", ""),
            spec,
            `cross-component import (${comp} → ${target[1]})`,
          ]);
          continue;
        }
      }

      // ── Rule 3: layer direction ──
      if (layer === "common" && !spec.startsWith("#common/")) {
        problems.push([
          rel.replace("foliplus/js/", ""),
          spec,
          "common imports outside #common",
        ]);
      } else if (layer === "ui" && !/^#(?:common|ui)\//.test(spec)) {
        problems.push([
          rel.replace("foliplus/js/", ""),
          spec,
          "ui imports outside #common/#ui",
        ]);
      } else if (layer === "core" && !/^#(?:common|core)\//.test(spec)) {
        problems.push([
          rel.replace("foliplus/js/", ""),
          spec,
          "core imports outside #common/#core",
        ]);
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
    const plugin = violations.filter(
      v => v[2].includes("cross-component") || v[2].includes("#control/*"),
    );
    expect(plugin, plugin.map(v => v.join(" ")).join("\n")).toEqual([]);
  });

  it("no non-plugin layer (common/ui/core/root) imports #control/*", () => {
    const violations = collect().filter(
      v => v[2] === "non-plugin layer imports #control/*",
    );
    expect(violations, violations.map(v => v.join(" ")).join("\n")).toEqual([]);
  });

  it("layers depend only downward (common/ui/core rules)", () => {
    const violations = collect().filter(
      v =>
        v[2].startsWith("common imports") ||
        v[2].startsWith("ui imports") ||
        v[2].startsWith("core imports"),
    );
    expect(violations, violations.map(v => v.join(" ")).join("\n")).toEqual([]);
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
