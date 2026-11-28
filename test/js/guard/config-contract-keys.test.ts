// test/js/guard/config-contract-keys — the CONFIG payload keeps one spelling.
//
// The CONFIG payload is the only surface both languages own, so its keys are
// snake_case on the Python side and read snake_case on the JS side.
// TypeScript's own vocabulary for the same concepts stays camelCase — the two
// must not converge. That is why this guard states both spellings per concept
// instead of scanning for one pattern:
//
//   contract key    TS internal name   where TS keeps the internal name
//   zoom_range      zoomRange          LayerInfo.zoomRange, INTENT.ZOOM_RANGE
//   fill_author     fillAuthor         LayerInfo.fillAuthor
//   per_feature     perFeature         FillAuthor.perFeature
//   base_url        baseUrl            CONF-only (ProviderConfig payload)
//   throttle_ms     throttleMs         GeocodeProvider.throttleMs
//
// Three failure modes, all of them shipped or nearly shipped before:
//
//   1. a camelCase read off a CONF-shaped receiver (`CONF.zoomRange`,
//      `row.fillAuthor`, `this.config.baseUrl`). The generated schema declares
//      the snake key, so such a read only compiles through a cast — and a cast
//      is exactly how the pre-#1341 drift stayed invisible to tsc.
//   2. a snake read outside the seam set. The rename crosses the language
//      boundary in a handful of files; a new one is a new seam and must be
//      added here deliberately, not discovered at runtime.
//   3. the TS internal name disappearing (renamed to snake). camelCase is
//      load-bearing: persisted user-state records (`overrides: ["zoomRange"]`),
//      the public `INTENT.ZOOM_RANGE` vocabulary, and the Leaflet adapter name.
//
// The contract keys are read from the generated `foliplus/js/config-schema.ts`,
// so a schema rename updates the guard's subject instead of silently passing.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SCHEMA_FILE = "foliplus/js/config-schema.ts";
const JS_ROOT = resolve(REPO_ROOT, "foliplus", "js");

/** One renamed concept: its CONF spelling, its TS spelling, and the TS owners
 *  that must keep the camelCase name alive. */
type ContractVocabulary = {
  key: string;
  internal: string;
  /** Files allowed to read the snake key, with the reason it is a seam. */
  seams: string[];
  /** Files that declare/own the camelCase internal name. */
  internalOwners: string[];
};

const CONTRACT_VOCABULARY: ContractVocabulary[] = [
  {
    key: "zoom_range",
    internal: "zoomRange",
    seams: [
      "control/HeatmapControl/index.ts",
      "control/LayerControl/index.ts",
      "control/MeasureControl/index.ts",
    ],
    internalOwners: ["core/layer/type.ts", "core/layer/intent.ts"],
  },
  {
    key: "fill_author",
    internal: "fillAuthor",
    seams: ["control/LayerControl/index.ts"],
    internalOwners: ["core/layer/type.ts"],
  },
  {
    key: "per_feature",
    internal: "perFeature",
    seams: ["control/LayerControl/index.ts"],
    internalOwners: ["core/layer/type.ts"],
  },
  {
    key: "base_url",
    internal: "baseUrl",
    seams: ["core/geocode/registry.ts"],
    internalOwners: [],
  },
  {
    key: "throttle_ms",
    internal: "throttleMs",
    seams: ["core/geocode/registry.ts"],
    internalOwners: ["core/geocode/type.ts"],
  },
];

/** The CONF-shaped receivers a contract key may be read from. */
const CONF_RECEIVERS = "CONF|conf|config|this\\.config|env\\.config|row|dataRow";

/** Read a repo-relative file, once per run. */
const rawCache = new Map<string, string>();
const read = (rel: string) => {
  let src = rawCache.get(rel);
  if (src === undefined) {
    src = readFileSync(resolve(REPO_ROOT, rel), "utf8");
    rawCache.set(rel, src);
  }
  return src;
};

/** Comment-stripped source per file, once per run: every scan below used to
 *  re-read and re-strip the whole 318-file tree (five contract keys × two
 *  scans), which is what pushed the seam test past the 10 s ceiling under
 *  coverage. */
const strippedCache = new Map<string, string>();
const strippedOf = (rel: string): string => {
  let src = strippedCache.get(rel);
  if (src === undefined) {
    src = stripComments(read(rel));
    strippedCache.set(rel, src);
  }
  return src;
};

let jsFileListCache: string[] | null = null;
const jsFileList = (): string[] => (jsFileListCache ??= jsFiles());

/** Drop TS comments, keeping newlines so line numbers stay meaningful. */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, m => "\n".repeat(m.split("\n").length - 1))
    .replace(/\/\/[^\n]*/g, "");

/** Every `foliplus/js` TS file as repo- relative paths. */
const jsFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        out.push(relative(REPO_ROOT, full).replace(/\\/g, "/"));
      }
    }
  };
  walk(JS_ROOT);
  return out.sort();
};

/** Property keys declared in the generated schema module. */
const schemaKeys = (src: string): string[] => {
  const keys: string[] = [];
  for (const match of stripComments(src).matchAll(
    /(?:^|[;{])\s*([A-Za-z_$][\w$]*)\??\s*:/gm,
  )) {
    if (!keys.includes(match[1])) keys.push(match[1]);
  }
  return keys;
};

/** `zoom_range` → `zoomRange`; the mapping the rename table promises. */
const camelOf = (key: string): string =>
  key.replace(/_([a-z0-9])/g, (_all, ch: string) => ch.toUpperCase());

/** camelCase reads of a contract key in already comment-stripped source. */
const findCamelConfReadsStripped = (src: string, key: string): string[] => {
  const camel = camelOf(key);
  // Prefilter before the regex: a hit needs the camelCase spelling to exist.
  if (!src.includes(camel)) return [];
  const pattern = new RegExp(`\\b(?:${CONF_RECEIVERS})\\.${camel}\\b`, "g");
  return [...src.matchAll(pattern)].map(m => m[0]);
};

/** camelCase reads of a contract key off a CONF-shaped receiver. */
const findCamelConfReads = (src: string, key: string): string[] =>
  findCamelConfReadsStripped(stripComments(src), key);

/** Files in the tree that read `.key` in code (comments do not count). */
const snakeReaders = (key: string): string[] =>
  jsFileList()
    .map(rel => ({ rel, src: strippedOf(rel) }))
    .filter(
      ({ src }) => src.includes(`.${key}`) && new RegExp(`\\.${key}\\b`).test(src),
    )
    .map(({ rel }) => rel.replace(/^foliplus[\\/]js[\\/]/, ""));

describe("CONFIG contract keys — one spelling per side", () => {
  it("derives its subject from the generated schema and keeps the rename table honest", () => {
    const keys = schemaKeys(read(SCHEMA_FILE));
    for (const { key, internal } of CONTRACT_VOCABULARY) {
      expect(keys, `contract key ${key} is not declared in ${SCHEMA_FILE}`).toContain(
        key,
      );
      expect(internal, `${key} → ${internal} is not the camelCase spelling`).toBe(
        camelOf(key),
      );
    }
  });

  it("never reads a contract key off a CONF-shaped receiver in camelCase", () => {
    const violations: string[] = [];
    for (const { key } of CONTRACT_VOCABULARY) {
      for (const rel of jsFileList()) {
        for (const hit of findCamelConfReadsStripped(strippedOf(rel), key)) {
          violations.push(`${rel.split(/[\\/]/).join("/")}: ${hit}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("reads each snake contract key only at its declared seams", () => {
    for (const { key, seams } of CONTRACT_VOCABULARY) {
      const actual = snakeReaders(key);
      const missing = actual.filter(rel => !seams.includes(rel));
      const stale = seams.filter(rel => !actual.includes(rel));
      expect(missing, `${key} is read outside its declared seam files`).toEqual([]);
      expect(stale, `${key} seam list names files that no longer read it`).toEqual([]);
    }
  });

  it("keeps the camelCase internal name alive where TypeScript owns it", () => {
    for (const { key, internal, internalOwners } of CONTRACT_VOCABULARY) {
      for (const rel of internalOwners) {
        expect(
          existsSync(resolve(REPO_ROOT, "foliplus", "js", rel)),
          `${rel} is missing`,
        ).toBe(true);
        expect(
          stripComments(read(`foliplus/js/${rel}`)),
          `${rel} no longer carries the internal name ${internal} (renamed to ${key}?)`,
        ).toContain(internal);
      }
    }
  });

  it("keeps the Leaflet adapter file and the INTENT vocabulary camelCase", () => {
    expect(existsSync(resolve(JS_ROOT, "core", "leaflet", "zoomRange.ts"))).toBe(true);
    expect(stripComments(read("foliplus/js/core/layer/intent.ts"))).toContain(
      'ZOOM_RANGE: "zoomRange"',
    );
  });
});

describe("CONFIG contract keys — guard teeth", () => {
  it("flags a camelCase read off CONF", () => {
    expect(findCamelConfReads("const v = CONF.zoomRange;", "zoom_range")).toEqual([
      "CONF.zoomRange",
    ]);
    expect(findCamelConfReads("row.fillAuthor ? 1 : 0", "fill_author")).toEqual([
      "row.fillAuthor",
    ]);
  });

  it("does not flag the camelCase internal name on a TS-owned receiver", () => {
    expect(findCamelConfReads("layerInfo.zoomRange", "zoom_range")).toEqual([]);
    expect(findCamelConfReads("map.foliplus.zoomRange", "zoom_range")).toEqual([]);
  });

  it("ignores comments and picks camelOf apart", () => {
    expect(findCamelConfReads("// CONF.zoomRange", "zoom_range")).toEqual([]);
    expect(camelOf("zoom_range")).toBe("zoomRange");
    expect(camelOf("per_feature")).toBe("perFeature");
    expect(camelOf("throttle_ms")).toBe("throttleMs");
  });

  it("reads property keys out of the generated shapes", () => {
    const keys = schemaKeys("type X = {\n  zoom_range?: { min: number };\n};\n");
    expect(keys).toContain("zoom_range");
    expect(keys).toContain("min");
  });
});
