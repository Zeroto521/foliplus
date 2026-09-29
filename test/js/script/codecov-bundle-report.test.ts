import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { gzipSync } from "zlib";
import {
  BUNDLE_NAME_RE,
  PAYLOAD_VERSION,
  buildCodecovPayload,
  chunkIdFromOutput,
  gzipSizeOfFile,
  normalizeModulePath,
  payloadToJson,
} from "#script/codecov-bundle-report.mjs";

// ── Fixture metafile (shape matches esbuild 0.24 / mergeMetafiles) ──
// Two artifacts sharing one module so chunkUniqueIds merge is exercised.
// `imports` on inputs must be ignored (schema has no edges).
const makeMetafile = () => ({
  inputs: {
    "foliplus/js/SearchControl/index.ts": {
      bytes: 800,
      imports: [
        { path: "foliplus/js/SearchControl/logic.ts", kind: "import-statement" },
      ],
    },
    "foliplus/js/SearchControl/logic.ts": {
      bytes: 1200,
      imports: [{ path: "foliplus/js/common/cache.ts", kind: "import-statement" }],
    },
    "foliplus/js/common/cache.ts": {
      bytes: 400,
      imports: [],
    },
  },
  outputs: {
    "foliplus/dist/foliplus-SearchControl.min.js": {
      bytes: 2100,
      entryPoint: "foliplus/js/SearchControl/index.ts",
      inputs: {
        "foliplus/js/SearchControl/index.ts": { bytesInOutput: 500 },
        "foliplus/js/SearchControl/logic.ts": { bytesInOutput: 900 },
        "foliplus/js/common/cache.ts": { bytesInOutput: 300 },
      },
    },
    "foliplus/dist/foliplus-SearchControl.min.css": {
      bytes: 400,
      inputs: {
        "foliplus/js/common/cache.ts": { bytesInOutput: 40 },
      },
    },
    "foliplus/dist/foliplus-SearchControl.min.js.map": {
      bytes: 9999,
      inputs: {},
    },
  },
});

const root = () => {
  const dir = mkdtempSync(join(tmpdir(), "foliplus-codecov-"));
  mkdirSync(resolve(dir, "foliplus/dist"), { recursive: true });
  return dir;
};

let tmp = "";
afterEach(() => {
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  }
});

// ── bundleName validation ────────────────────────────────────────────
describe("bundleName", () => {
  it("accepts the foliplus default", () => {
    expect(BUNDLE_NAME_RE.test("foliplus")).toBe(true);
    expect(BUNDLE_NAME_RE.test("@scope/pkg-name_v1.0")).toBe(true);
  });

  it("rejects spaces and other out-of-pattern characters", () => {
    expect(BUNDLE_NAME_RE.test("has space")).toBe(false);
    expect(BUNDLE_NAME_RE.test("bad!char")).toBe(false);
  });

  it("buildCodecovPayload throws on a bad bundleName", () => {
    expect(() =>
      buildCodecovPayload({
        metafile: makeMetafile(),
        root: "/tmp/x",
        bundleName: "bad name",
        gzipOf: () => 1,
      }),
    ).toThrow(/bundleName/);
  });
});

// ── metafile validation ──────────────────────────────────────────────
describe("buildCodecovPayload input", () => {
  it("requires metafile.outputs", () => {
    expect(() =>
      buildCodecovPayload({ metafile: { inputs: {} }, root: "/tmp" }),
    ).toThrow(/outputs/);
    expect(() =>
      buildCodecovPayload({ metafile: null as never, root: "/tmp" }),
    ).toThrow(/outputs/);
  });
});

// ── Path normalization ───────────────────────────────────────────────
describe("normalizeModulePath", () => {
  it("prefixes in-tree modules with ./ and uses POSIX separators", () => {
    expect(normalizeModulePath("foliplus/js/a.ts", "/proj")).toBe("./foliplus/js/a.ts");
  });

  it("leaves out-of-tree modules unprefixed (matches rollup plugin)", () => {
    // relative() of something outside root yields ../...
    const outside = normalizeModulePath(resolve("/elsewhere/lib.js"), "/proj");
    expect(outside.startsWith("..")).toBe(true);
    expect(outside.includes("\\")).toBe(false);
  });
});

describe("chunkIdFromOutput", () => {
  it("strips the foliplus- prefix and .min.ext suffix", () => {
    expect(chunkIdFromOutput("foliplus/dist/foliplus-SearchControl.min.js")).toBe(
      "SearchControl",
    );
    expect(chunkIdFromOutput("x/foliplus-common.min.css")).toBe("common");
  });
});

// ── Asset / chunk / module mapping ───────────────────────────────────
describe("buildCodecovPayload mapping", () => {
  it("emits version 3, bundleName, and one asset/chunk per shippable output", () => {
    tmp = root();
    writeFileSync(resolve(tmp, "foliplus/dist/foliplus-SearchControl.min.js"), "js");
    writeFileSync(resolve(tmp, "foliplus/dist/foliplus-SearchControl.min.css"), "css");

    const payload = buildCodecovPayload({
      metafile: makeMetafile(),
      root: tmp,
      bundleName: "foliplus",
      gzipOf: () => 12,
      now: () => 1_700_000_000_000,
    });

    expect(payload.version).toBe(PAYLOAD_VERSION);
    expect(payload.bundleName).toBe("foliplus");
    expect(payload.bundler).toEqual({ name: "esbuild", version: "0.24.0" });
    expect(payload.builtAt).toBe(1_700_000_000_000);
    // .map is dropped
    expect(payload.assets).toHaveLength(2);
    expect(payload.chunks).toHaveLength(2);
  });

  it("assets.size is raw metafile bytes; name is the bare filename", () => {
    tmp = root();
    const payload = buildCodecovPayload({
      metafile: makeMetafile(),
      root: tmp,
      gzipOf: () => 7,
    });
    const js = payload.assets.find(a => a.name.endsWith(".js"));
    const css = payload.assets.find(a => a.name.endsWith(".css"));
    expect(js.size).toBe(2100);
    expect(css.size).toBe(400);
    expect(js.name).toBe("foliplus-SearchControl.min.js");
    expect(js.normalized).toBe("foliplus-SearchControl.min.js");
  });

  it("chunks carry entry flag from entryPoint and empty dynamicImports", () => {
    tmp = root();
    const payload = buildCodecovPayload({
      metafile: makeMetafile(),
      root: tmp,
      gzipOf: () => 1,
    });
    const js = payload.chunks.find(c => c.files[0].endsWith(".js"));
    const css = payload.chunks.find(c => c.files[0].endsWith(".css"));
    expect(js.entry).toBe(true);
    expect(css.entry).toBe(false);
    expect(js.dynamicImports).toEqual([]);
    expect(js.names).toEqual(["SearchControl"]);
    expect(js.id).toBe("SearchControl");
    expect(js.uniqueId).toMatch(/^\d+-SearchControl$/);
  });

  it("modules.size is bytesInOutput and shared modules merge chunk ids", () => {
    tmp = root();
    const payload = buildCodecovPayload({
      metafile: makeMetafile(),
      root: tmp,
      gzipOf: () => 1,
    });
    const cache = payload.modules.find(m => m.name.endsWith("common/cache.ts"));
    expect(cache).toBeDefined();
    // 300 (js) + 40 (css)
    expect(cache!.size).toBe(340);
    expect(cache!.chunkUniqueIds).toHaveLength(2);

    const logic = payload.modules.find(m => m.name.endsWith("logic.ts"));
    expect(logic).toBeDefined();
    expect(logic!.size).toBe(900);
    expect(logic!.chunkUniqueIds).toHaveLength(1);

    // No edge field anywhere — inputs[].imports must not leak in.
    const json = payloadToJson(payload);
    expect(json).not.toMatch(/imports/);
    expect(json).not.toMatch(/byteInOutput/);
  });

  it("modules are sorted by name for a stable payload", () => {
    tmp = root();
    const payload = buildCodecovPayload({
      metafile: makeMetafile(),
      root: tmp,
      gzipOf: () => 1,
    });
    const names = payload.modules.map(m => m.name);
    expect(names).toEqual([...names].sort());
  });
});

// ── gzipSize must be a real gzip measurement ─────────────────────────
describe("gzipSize", () => {
  it("measures the on-disk artifact with zlib.gzip (not brotli, not raw)", () => {
    tmp = root();
    // A payload whose gzip length differs from both raw and brotli.
    const body = "const a = 1;\n".repeat(200);
    const file = resolve(tmp, "foliplus/dist/foliplus-SearchControl.min.js");
    writeFileSync(file, body);
    writeFileSync(resolve(tmp, "foliplus/dist/foliplus-SearchControl.min.css"), "x");

    const expected = gzipSync(Buffer.from(body)).length;
    const payload = buildCodecovPayload({
      metafile: makeMetafile(),
      root: tmp,
    });
    const js = payload.assets.find(a => a.name.endsWith(".js"));
    expect(js.gzipSize).toBe(expected);
    expect(js.gzipSize).not.toBe(js.size);
    expect(gzipSizeOfFile(file)).toBe(expected);
  });

  it("is null for non-compressible extensions (schema allows null)", () => {
    tmp = root();
    // .woff is outside COMPRESSIBLE_ASSETS_RE (bundler-plugin-core
    // getCompressedSize.ts) — same null the official plugins emit.
    const metafile = {
      inputs: {},
      outputs: {
        "foliplus/dist/foliplus-icon.woff": {
          bytes: 50,
          inputs: {},
        },
      },
    };
    const payload = buildCodecovPayload({ metafile, root: tmp, gzipOf: () => 1 });
    expect(payload.assets).toHaveLength(1);
    expect(payload.assets[0].gzipSize).toBeNull();
  });

  it("uses the injected meter when provided (no file I/O in pure tests)", () => {
    const seen: string[] = [];
    const payload = buildCodecovPayload({
      metafile: makeMetafile(),
      root: "/virtual",
      gzipOf: p => {
        seen.push(p);
        return 42;
      },
    });
    expect(payload.assets.every(a => a.gzipSize === 42)).toBe(true);
    expect(seen).toHaveLength(2);
  });
});

// ── Optional-metafile branches (the `??` fallbacks) ──────────────────
// v8 counts each `??` as a branch; the default side is easy to leave
// untested because every happy-path fixture fills the field in.
describe("metafile field fallbacks", () => {
  it("resolves absolute output keys without re-rooting them", () => {
    tmp = root();
    const artifactFile = resolve(tmp, "foliplus/dist/foliplus-A.min.js");
    writeFileSync(artifactFile, "js");
    const metafile = {
      inputs: {},
      outputs: {
        [artifactFile]: { bytes: 2, entryPoint: "src/a.ts", inputs: {} },
      },
    };
    const seen: string[] = [];
    const payload = buildCodecovPayload({
      metafile,
      root: tmp,
      gzipOf: p => {
        seen.push(p);
        return 9;
      },
    });
    expect(payload.assets[0].name).toBe("foliplus-A.min.js");
    // Absolute key is used as-is — never `resolve(root, abs)` which would
    // produce a nested `tmp/tmp/...` path and a missing-file gzip crash.
    expect(seen[0]).toBe(artifactFile);
  });

  it("treats a missing `bytes` as 0, not undefined", () => {
    const payload = buildCodecovPayload({
      metafile: {
        inputs: {},
        outputs: {
          "foliplus/dist/foliplus-A.min.js": { inputs: {} },
        },
      },
      root: "/virtual",
      gzipOf: () => 1,
    });
    expect(payload.assets[0].size).toBe(0);
  });

  it("treats a missing `inputs` map as empty modules for that artifact", () => {
    const payload = buildCodecovPayload({
      metafile: {
        inputs: {},
        outputs: {
          "foliplus/dist/foliplus-A.min.js": { bytes: 10 },
        },
      },
      root: "/virtual",
      gzipOf: () => 1,
    });
    expect(payload.assets).toHaveLength(1);
    expect(payload.modules).toEqual([]);
  });

  it("treats a missing `bytesInOutput` as 0", () => {
    const payload = buildCodecovPayload({
      metafile: {
        inputs: {},
        outputs: {
          "foliplus/dist/foliplus-A.min.js": {
            bytes: 10,
            inputs: { "src/a.ts": {} },
          },
        },
      },
      root: "/virtual",
      gzipOf: () => 1,
    });
    expect(payload.modules).toHaveLength(1);
    expect(payload.modules[0].size).toBe(0);
  });

  it("merges one module that lands in two artifacts (dedup by name)", () => {
    const payload = buildCodecovPayload({
      metafile: {
        inputs: {},
        outputs: {
          "foliplus/dist/foliplus-A.min.js": {
            bytes: 1,
            inputs: { "src/dup.ts": { bytesInOutput: 1 } },
          },
          "foliplus/dist/foliplus-B.min.js": {
            bytes: 1,
            inputs: { "src/dup.ts": { bytesInOutput: 2 } },
          },
        },
      },
      root: "/virtual",
      gzipOf: () => 1,
    });
    expect(payload.modules).toHaveLength(1);
    expect(payload.modules[0].size).toBe(3);
    expect(payload.modules[0].chunkUniqueIds).toHaveLength(2);
  });
});
