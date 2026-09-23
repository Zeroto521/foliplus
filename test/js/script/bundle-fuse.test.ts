import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXIT_FUSE,
  EXIT_OK,
  EXIT_UNKNOWN,
  FUSE_CAPS,
  fuse,
  readSizes,
} from "#script/bundle-fuse.mjs";

// The fuse judges brotli bytes. A repeated-literal fixture would collapse to
// a few bytes and quietly land under every cap, so the "breach" case would
// become a no-op. `payload` is incompressible — its brotli size tracks its
// raw length, so a 20 KB fixture really does measure as ~20 KB.
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
    "fuse-test-" + Date.now() + "-" + Math.random().toString(36).slice(2),
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

// The gate must actually trip. A fuse whose body degenerates to
// `return 0` (the "gate that always passes") would still satisfy every
// positive assertion about table contents — but not these, which call
// `fuse()` on a real dist directory and check its exit code.
describe("bundle-fuse exit codes", () => {
  it("returns EXIT_FUSE when an artifact exceeds its cap", () => {
    const root = mkTmp();
    // LocateControl's cap is 4.88 KB brotli; a 20 KB incompressible payload
    // lands far above it, so the breach is unambiguous.
    mkDist(root, { "foliplus-LocateControl.min.js": payload(20 * 1024) });
    expect(fuse({}, root)).toBe(EXIT_FUSE);
  });

  it("returns EXIT_FUSE when the dist tree holds no minified artifacts", () => {
    // The fuse is supposed to be the "always on" gate; a missing dist/ is
    // a build error the caller must fix, so it exits non-zero rather than
    // silently passing an empty report.
    const root = mkTmp();
    mkDist(root, {});
    expect(fuse({}, root)).toBe(EXIT_FUSE);
  });

  it("returns 0 when every artifact is under its cap", () => {
    const root = mkTmp();
    // One trivial file per cap key: every measured size is 1-2 B brotli,
    // well below any cap, so no breach and no unknown.
    const files: Record<string, string> = {};
    for (const key of Object.keys(FUSE_CAPS)) files[key] = "x";
    mkDist(root, files);
    expect(fuse({}, root)).toBe(EXIT_OK);
  });

  it("returns EXIT_UNKNOWN when a dist artifact has no cap entry", () => {
    const root = mkTmp();
    mkDist(root, {
      "foliplus-LocateControl.min.js": "x",
      "foliplus-NewControl.min.js": payload(512),
    });
    // The unknown takes precedence over the all-under-cap verdict — a
    // genuinely new bundle should not slip through as a silent pass.
    expect(fuse({}, root)).toBe(EXIT_UNKNOWN);
  });

  // Reverse proof: the breach assertion above would still pass if the caps
  // table were empty (`cap == null` would put the artifact in `unknown`,
  // which is a different exit code). This pairs with `under cap` above:
  // both must be reachable for the exit codes to be meaningful.
  it("reads real sizes off disk", () => {
    const root = mkTmp();
    mkDist(root, { "foliplus-LocateControl.min.js": payload(20 * 1024) });
    const sizes = readSizes(root);
    // 20 KB incompressible -> brotli size well over LocateControl's 4.88 KB
    // cap; that is exactly the condition the breach test above relies on.
    expect(sizes["foliplus-LocateControl.min.js"]).toBeGreaterThan(
      FUSE_CAPS["foliplus-LocateControl.min.js"],
    );
  });
});

// Cap table hygiene. A stray entry with a non-positive cap would make the
// fuse fire on every build (0 means even empty output breaches); a key
// that no artifact matches would leave its artifact in `unknown` and force
// a review event nobody can explain. Neither is recoverable from the
// exit-code tests above, so the table is asserted on its own.
describe("bundle-fuse cap table", () => {
  it("has at least one entry per artifact kind", () => {
    const jsCaps = Object.entries(FUSE_CAPS).filter(([k]) => k.endsWith(".min.js"));
    const cssCaps = Object.entries(FUSE_CAPS).filter(([k]) => k.endsWith(".min.css"));
    expect(jsCaps.length).toBeGreaterThan(0);
    expect(cssCaps.length).toBeGreaterThan(0);
  });

  it("every cap is a positive integer", () => {
    for (const [key, cap] of Object.entries(FUSE_CAPS)) {
      expect(Number.isInteger(cap), key).toBe(true);
      expect(cap, key).toBeGreaterThan(0);
    }
  });

  it("every cap key is a plausible artifact name", () => {
    for (const key of Object.keys(FUSE_CAPS)) {
      expect(key, key).toMatch(/^foliplus-[A-Za-z]+\.min\.(js|css)$/);
    }
  });

  it("does not duplicate artifact names", () => {
    const keys = Object.keys(FUSE_CAPS);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
