import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { brotliCompressSync } from "zlib";
import {
  EXIT_FUSE,
  EXIT_NO_BASELINE,
  EXIT_OK,
  EXIT_THRESHOLD,
  EXIT_UNKNOWN,
  ROOT,
  baseSpec,
  distDir,
  fmtBytes,
  parseArgsWithBase,
  readSizes,
  stripLeadingBlockComment,
} from "#script/bundle-size-lib.mjs";

const rSizes = (root: string): Record<string, number> =>
  readSizes(root) as Record<string, number>;

const BundleArgs = (
  argv: string[] = [],
  extra: Record<string, unknown> = {},
): Record<string, unknown> & { errors: string[] } =>
  parseArgsWithBase(argv, extra) as Record<string, unknown> & { errors: string[] };

// ── Exit codes ──────────────────────────────────────────────────────────────
// One table, shared by both gates. Every code is a distinct meaning; a
// duplicate number (the pre-refactor collision where EXIT_THRESHOLD and
// EXIT_UNKNOWN both lived at 2) would make a threshold breach and a
// new-unknown bundle read alike in CI.
describe("exit codes", () => {
  it("are all distinct numbers", () => {
    const codes = [EXIT_OK, EXIT_FUSE, EXIT_THRESHOLD, EXIT_UNKNOWN, EXIT_NO_BASELINE];
    expect(new Set(codes).size, "each code must mean exactly one thing").toBe(
      codes.length,
    );
  });

  it("start at zero and never use a negative", () => {
    for (const code of [
      EXIT_OK,
      EXIT_FUSE,
      EXIT_THRESHOLD,
      EXIT_UNKNOWN,
      EXIT_NO_BASELINE,
    ]) {
      expect(code, `exit code ${code}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("reserve 0 for the pass verdict", () => {
    expect(EXIT_OK).toBe(0);
  });
});

// ── dist dir resolution ─────────────────────────────────────────────────────
describe("distDir", () => {
  it("resolves <root>/foliplus/dist for the project root", () => {
    expect(distDir(ROOT)).toBe(resolve(ROOT, "foliplus/dist"));
  });

  it("honors an alternate root (a capture from another checkout)", () => {
    expect(distDir("/tmp/base")).toBe(resolve("/tmp/base", "foliplus/dist"));
  });
});

// ── Banner stripping ────────────────────────────────────────────────────────
describe("stripLeadingBlockComment", () => {
  // The banner esbuild emits is the leading block comment; everything after
  // it is runtime code. Stripping must remove only the first block, and the
  // result must remain parseable JavaScript (the invariant the two gates
  // rely on: they measure the same bytes).
  const BANNER = "/*! foliplus v0.1.0 */";

  it("drops the leading banner and keeps the rest", () => {
    expect(stripLeadingBlockComment(`${BANNER}const x = 1;`)).toBe("const x = 1;");
  });

  it("drops the banner even when there is trailing whitespace", () => {
    expect(stripLeadingBlockComment(`${BANNER}   const x = 1;`)).toBe("const x = 1;");
  });

  it("tolerates a BOM before the banner", () => {
    expect(stripLeadingBlockComment(`\uFEFF${BANNER}const x = 1;`)).toBe(
      "const x = 1;",
    );
  });

  it("leaves a file with no banner unchanged (the identity case)", () => {
    const src = "const x = 1;";
    expect(stripLeadingBlockComment(src)).toBe(src);
  });

  it("does not strip a block comment that is not leading", () => {
    // A banner at the front is dropped; a block comment inside the body is
    // left alone. The regex is anchored to the start.
    expect(stripLeadingBlockComment("const x = 1; /* trailing */")).toBe(
      "const x = 1; /* trailing */",
    );
  });
});

// ── Size reading ────────────────────────────────────────────────────────────
describe("readSizes", () => {
  // readSizes compresses with brotli, and brotli crushes a repeated literal
  // to a few bytes: a fixture like "a" x 2000 compresses to ~10 B and would
  // silently land under any fuse cap. The payload below is incompressible —
  // its brotli size tracks its raw length, so a fixture really does measure
  // as what we say.
  const payload = (bytes: number) => {
    let x = 0x2f6e2b1;
    let out = "";
    for (let i = 0; i < bytes; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      out += String.fromCharCode(33 + (x % 94));
    }
    return out;
  };

  let tmpRoots: string[] = [];
  const mkTmp = (): string => {
    const dir = join(
      tmpdir(),
      "lib-test-" + Date.now() + "-" + Math.random().toString(36).slice(2),
    );
    tmpRoots.push(dir);
    return dir;
  };
  const mkDist = (root: string, files: Record<string, string>) => {
    const dir = join(root, "foliplus", "dist");
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, "utf-8");
    }
  };

  afterEach(() => {
    for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
    tmpRoots = [];
  });

  it("returns an empty object when dist/ holds no minified artifacts", () => {
    const root = mkTmp();
    mkDist(root, {});
    expect(rSizes(root)).toEqual({});
  });

  it("reads the brotli size of every *.min.{js,css} and sorts by name", () => {
    const root = mkTmp();
    mkDist(root, {
      "foliplus-zzz.min.css": payload(512),
      "foliplus-aaa.min.js": payload(512),
    });
    const sizes = rSizes(root);
    expect(Object.keys(sizes)).toEqual(["foliplus-aaa.min.js", "foliplus-zzz.min.css"]);
    // A 512-byte incompressible payload: its brotli size tracks its length.
    expect(sizes["foliplus-aaa.min.js"]).toBeGreaterThan(400);
    expect(sizes["foliplus-aaa.min.js"]).toBeLessThan(800);
  });

  it("ignores non-minified files in the dist tree", () => {
    const root = mkTmp();
    mkDist(root, {
      "not-min.js": "const x = 1;",
      "artifacts.json": "{}",
      "foliplus-common.min.js": payload(512),
    });
    const sizes = rSizes(root);
    expect(Object.keys(sizes)).toEqual(["foliplus-common.min.js"]);
  });

  it("strips the leading banner before compressing (the invariant both gates rely on)", () => {
    // Two files with the same runtime code but different banners must measure
    // identically: the banner is esbuild-config noise, not shipped code.
    // Without the strip the two numbers would disagree by the banner's
    // compressed length.
    const root = mkTmp();
    const code = payload(512);
    mkDist(root, {
      "with-banner.min.js": `/*! banner */${code}`,
      "no-banner.min.js": code,
    });
    const sizes = rSizes(root);
    expect(sizes["with-banner.min.js"]).toBe(sizes["no-banner.min.js"]);
  });
});

// ── Byte formatting ─────────────────────────────────────────────────────────
describe("fmtBytes", () => {
  it("formats a byte count as a two-decimal KB string", () => {
    expect(fmtBytes(1024)).toBe("1.00 KB");
    expect(fmtBytes(1536)).toBe("1.50 KB");
    expect(fmtBytes(0)).toBe("0.00 KB");
  });

  it("rounds half-values the way toFixed does", () => {
    // 1024/2 = 0.5 KB exactly; fmtBytes must not lose it to a truncating
    // integer divide.
    expect(fmtBytes(512)).toBe("0.50 KB");
  });
});

// ── SPEC base ───────────────────────────────────────────────────────────────
describe("baseSpec", () => {
  it("declares --root as a string flag", () => {
    expect(baseSpec.root.type).toBe("string");
    expect(baseSpec.root.desc).toContain("Project root");
  });

  it("does not declare any other flag (extras come from the caller)", () => {
    expect(Object.keys(baseSpec)).toEqual(["root"]);
  });
});

// ── Arg parsing ─────────────────────────────────────────────────────────────
describe("parseArgsWithBase", () => {
  it("returns a `root` key even when the caller's spec does not mention it", () => {
    const args = BundleArgs([], {});
    expect(args).toHaveProperty("root");
  });

  it("merges the caller's extra flags alongside --root", () => {
    const args = BundleArgs(["--root=/tmp/x", "--emit=/tmp/y.json"], {
      emit: { type: "string" },
    });
    expect(args.root).toBe("/tmp/x");
    expect(args.emit).toBe("/tmp/y.json");
  });

  it("collects malformed input into args.errors rather than throwing", () => {
    // A non-numeric threshold is an error the caller surfaces via
    // `args.errors.length` — the same contract the other build scripts use.
    const args = BundleArgs(["--threshold=abc"], {
      threshold: { type: "number", default: 10 },
    });
    expect(args.errors.length).toBeGreaterThan(0);
    expect(args.threshold).toBe(10);
  });

  it("defaults bool flags to false", () => {
    const args = BundleArgs([], { enforce: { type: "bool" } });
    expect(args.enforce).toBe(false);
  });
});
